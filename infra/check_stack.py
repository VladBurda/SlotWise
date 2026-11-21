"""Read-only smoke checks for a running local SlotWise Compose stack."""

import json
import smtplib
from urllib.request import urlopen


def main() -> None:
    for origin in ("http://127.0.0.1:8000", "http://127.0.0.1:5173"):
        with urlopen(f"{origin}/api/v1/health/live", timeout=10) as response:
            assert json.load(response) == {"status": "ok", "version": "0.1.0"}
        with urlopen(f"{origin}/api/v1/health/ready", timeout=10) as response:
            assert json.load(response) == {
                "status": "ready",
                "database": True,
                "redis": True,
            }
        with urlopen(f"{origin}/api/openapi.json", timeout=10) as response:
            assert "/api/v1/health/ready" in json.load(response)["paths"]
        print(f"PASS: liveness, readiness and OpenAPI through {origin}")

    with urlopen("http://127.0.0.1:5173/", timeout=10) as response:
        assert "SlotWise" in response.read().decode()
        assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    with urlopen("http://127.0.0.1:8025/", timeout=10) as response:
        assert response.status == 200
    with smtplib.SMTP("127.0.0.1", 1025, timeout=10) as smtp:
        assert smtp.ehlo()[0] == 250
    print("PASS: frontend, Mailpit HTTP and SMTP greeting (no email sent)")


if __name__ == "__main__":
    main()
