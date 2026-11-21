import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from slotwise.api.v1.health import router
from slotwise.auth.routes import router as auth_router
from slotwise.business.routes import router as business_router
from slotwise.core.config import Settings, get_settings
from slotwise.core.errors import DomainError
from slotwise.core.logging import configure_logging
from slotwise.notifications.mail import mail_loop
from slotwise.tenants.routes import router as tenant_router


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or get_settings()
    if config.environment == "production":
        if (
            config.mail_secret.get_secret_value().startswith("slotwise-local")
            or len(config.mail_secret.get_secret_value()) < 32
            or not config.public_url.startswith("https://")
            or any(not origin.startswith("https://") for origin in config.trusted_origins)
        ):
            raise ValueError("Production requires an explicit mail secret and HTTPS origins")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging()
        app.state.settings = config
        app.state.engine = create_async_engine(
            config.database_url.get_secret_value(),
            pool_pre_ping=True,
        )
        app.state.redis = Redis.from_url(config.redis_url.get_secret_value())
        app.state.sessions = async_sessionmaker(app.state.engine, expire_on_commit=False)
        worker = (
            asyncio.create_task(mail_loop(app.state.sessions, config))
            if config.mail_worker_enabled
            else None
        )
        logging.getLogger("slotwise").info("Application started")
        try:
            yield
        finally:
            if worker is not None:
                worker.cancel()
                with suppress(asyncio.CancelledError):
                    await worker
            await app.state.redis.aclose()
            await app.state.engine.dispose()
            logging.getLogger("slotwise").info("Application stopped")

    app = FastAPI(
        title="SlotWise API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs" if config.environment != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if config.environment != "production" else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )

    @app.middleware("http")
    async def private_responses(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content={"error": {"code": error.code, "message": error.message}},
            headers={
                "Cache-Control": "no-store",
                **({"Retry-After": "60"} if error.status == 429 else {}),
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, error: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                "error": {
                    "code": "conflict",
                    "message": "This record already exists or conflicts with another change.",
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Check the submitted fields.",
                    "details": [
                        {
                            "field": ".".join(str(part) for part in item["loc"]),
                            "message": item["msg"],
                        }
                        for item in error.errors()
                    ],
                }
            },
        )

    app.include_router(router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(tenant_router, prefix="/api/v1")
    app.include_router(business_router, prefix="/api/v1")
    return app


app = create_app()
