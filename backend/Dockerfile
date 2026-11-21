FROM ghcr.io/astral-sh/uv:0.13.6 AS uv
FROM python:3.13-slim AS runtime
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY alembic.ini ./
COPY alembic ./alembic
RUN uv sync --frozen --no-dev && useradd --create-home app
USER app
EXPOSE 8000
CMD [".venv/bin/uvicorn", "slotwise.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM runtime AS test
USER root
RUN uv sync --frozen
COPY tests ./tests
USER app
CMD [".venv/bin/pytest", "-q", "-p", "no:cacheprovider"]

# Keep test dependencies and test files out of the default runtime image.
FROM runtime AS production
