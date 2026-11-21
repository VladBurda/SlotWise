from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SLOTWISE_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://slotwise:slotwise_local@localhost:5432/slotwise"
    )
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    cors_origins: list[str] = ["http://localhost:5173"]
    dependency_timeout_seconds: float = Field(default=2.0, gt=0, le=10)
    public_url: str = "http://localhost:5173"
    trusted_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    access_seconds: int = Field(default=900, ge=60)
    session_seconds: int = Field(default=2592000, ge=900)
    auth_rate_limit: int = Field(default=20, ge=1)
    # Development-only encryption key material; production requires an explicit secret.
    mail_secret: SecretStr = SecretStr("slotwise-local-only-mail-secret-change-before-deploy")
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_starttls: bool = False
    mail_from: str = "SlotWise <noreply@slotwise.example>"
    mail_worker_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
