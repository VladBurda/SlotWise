import pytest
from fastapi import Response

from slotwise.auth.dependencies import cookie_name
from slotwise.auth.routes import set_cookies
from slotwise.auth.service import Credentials
from slotwise.core.config import Settings
from slotwise.main import create_app
from slotwise.tenants.schemas import WorkspaceInput


def test_production_requires_explicit_secret_and_https() -> None:
    with pytest.raises(ValueError, match="Production requires"):
        create_app(Settings(environment="production"))


def test_production_cookie_flags() -> None:
    settings = Settings(environment="production")
    response = Response()
    set_cookies(response, settings, Credentials("access", "refresh", "csrf", 3600))
    headers = response.headers.getlist("set-cookie")
    assert len(headers) == 3
    assert all(
        "Secure" in header and "SameSite=strict" in header and "Path=/" in header
        for header in headers
    )
    assert "HttpOnly" in headers[0] and "HttpOnly" in headers[1]
    assert "HttpOnly" not in headers[2]
    assert cookie_name(settings, "access") == "__Host-sw_access"
    assert all("Domain=" not in header for header in headers)


def test_workspace_timezone_and_slug_validation() -> None:
    assert (
        WorkspaceInput(name="Studio", slug="my-studio", timezone="Europe/Berlin").timezone
        == "Europe/Berlin"
    )
    with pytest.raises(ValueError):
        WorkspaceInput(name="Studio", slug="my-studio", timezone="Not/AZone")
    with pytest.raises(ValueError):
        WorkspaceInput(name="Studio", slug="Bad Slug")
