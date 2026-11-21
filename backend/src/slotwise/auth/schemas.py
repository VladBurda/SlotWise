from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Password = Annotated[str, Field(min_length=12, max_length=128)]


class EmailInput(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize(cls, value: str) -> str:
        return value.lower()


class RegisterInput(EmailInput):
    name: str = Field(min_length=1, max_length=100)
    password: Password

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value.strip()


class LoginInput(EmailInput):
    password: str = Field(min_length=1, max_length=128)


class TokenInput(BaseModel):
    token: str = Field(min_length=40, max_length=128)


class ResetInput(TokenInput):
    password: Password


class UserView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    name: str
    verified: bool


class Message(BaseModel):
    message: str
