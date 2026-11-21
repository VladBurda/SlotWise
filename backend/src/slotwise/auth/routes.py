from fastapi import APIRouter, Depends, Request, Response

from slotwise.auth.dependencies import Current, Db, cookie_name, csrf, rate_limit
from slotwise.auth.schemas import (
    EmailInput,
    LoginInput,
    Message,
    RegisterInput,
    ResetInput,
    TokenInput,
    UserView,
)
from slotwise.auth.security import token
from slotwise.auth.service import AuthService, Credentials
from slotwise.core.config import Settings

router = APIRouter(prefix="/auth", tags=["Authentication"])
writes = APIRouter(dependencies=[Depends(csrf), Depends(rate_limit)])


def set_cookies(response: Response, settings: Settings, credentials: Credentials) -> None:
    for kind, value, seconds in (
        ("access", credentials.access, settings.access_seconds),
        ("refresh", credentials.refresh, credentials.remaining),
        ("csrf", credentials.csrf, credentials.remaining),
    ):
        response.set_cookie(
            cookie_name(settings, kind),
            value,
            max_age=seconds,
            httponly=kind != "csrf",
            secure=settings.environment == "production",
            samesite="strict",
            path="/",
        )


@router.get("/csrf")
async def bootstrap(request: Request, response: Response) -> dict[str, str]:
    settings: Settings = request.app.state.settings
    name = cookie_name(settings, "csrf")
    value = request.cookies.get(name, "")
    if len(value) != 43:
        value = token()
        response.set_cookie(
            name,
            value,
            httponly=False,
            secure=settings.environment == "production",
            samesite="strict",
            path="/",
            max_age=settings.session_seconds,
        )
    response.headers["Cache-Control"] = "no-store"
    return {"csrf_token": value}


@writes.post("/register", response_model=Message, status_code=202)
async def register(data: RegisterInput, request: Request, db: Db) -> Message:
    await AuthService(db, request.app.state.settings).register(data)
    return Message(message="If this address can be registered, a verification email is on its way.")


@writes.post("/login", response_model=UserView)
async def login(data: LoginInput, request: Request, response: Response, db: Db) -> UserView:
    user, credentials = await AuthService(db, request.app.state.settings).login(
        str(data.email), data.password
    )
    set_cookies(response, request.app.state.settings, credentials)
    return UserView.model_validate(user)


@writes.post("/refresh", response_model=Message)
async def refresh(request: Request, response: Response, db: Db) -> Message:
    settings: Settings = request.app.state.settings
    credentials = await AuthService(db, settings).refresh(
        request.cookies.get(cookie_name(settings, "refresh"), ""),
        csrf(request),
    )
    set_cookies(response, settings, credentials)
    return Message(message="Session refreshed.")


@writes.post("/logout", response_model=Message)
async def logout(request: Request, response: Response, db: Db, current: Current) -> Message:
    await AuthService(db, request.app.state.settings).logout(current.user, current.session.id)
    for kind in ("access", "refresh", "csrf"):
        response.delete_cookie(
            cookie_name(request.app.state.settings, kind),
            path="/",
            secure=request.app.state.settings.environment == "production",
            httponly=kind != "csrf",
            samesite="strict",
        )
    return Message(message="Signed out.")


@router.get("/me", response_model=UserView)
async def me(current: Current, response: Response) -> UserView:
    response.headers["Cache-Control"] = "no-store"
    return UserView.model_validate(current.user)


@writes.post("/request-verification", response_model=Message, status_code=202)
async def request_verification(data: EmailInput, request: Request, db: Db) -> Message:
    await AuthService(db, request.app.state.settings).request_action(str(data.email), "verify")
    return Message(message="If verification is needed, an email is on its way.")


@writes.post("/verify-email", response_model=Message)
async def verify_email(data: TokenInput, request: Request, db: Db) -> Message:
    await AuthService(db, request.app.state.settings).consume(data.token, "verify")
    return Message(message="Email verified. You can now create or join a workspace.")


@writes.post("/request-password-reset", response_model=Message, status_code=202)
async def request_reset(data: EmailInput, request: Request, db: Db) -> Message:
    await AuthService(db, request.app.state.settings).request_action(str(data.email), "reset")
    return Message(message="If the account exists, a password-reset email is on its way.")


@writes.post("/reset-password", response_model=Message)
async def reset_password(data: ResetInput, request: Request, db: Db) -> Message:
    await AuthService(db, request.app.state.settings).consume(data.token, "reset", data.password)
    return Message(message="Password updated. Please sign in again on all devices.")


router.include_router(writes)
