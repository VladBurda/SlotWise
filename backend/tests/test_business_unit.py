from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from slotwise.business.calendar import expand, instants
from slotwise.business.schemas import LocationInput, Policies


def test_dst_boundaries_and_elapsed_duration() -> None:
    assert instants(date(2026, 3, 29), 150, "Europe/Berlin") == ()
    assert instants(date(2026, 10, 25), 150, "Europe/Berlin") == (
        datetime(2026, 10, 25, 0, 30, tzinfo=UTC),
        datetime(2026, 10, 25, 1, 30, tzinfo=UTC),
    )
    for day, hours in [(date(2026, 3, 29), 3), (date(2026, 10, 25), 5)]:
        start, end = expand(day, 0, 240, "Europe/Berlin")
        assert (end - start).total_seconds() == hours * 3600
    with pytest.raises(ValueError, match="nonexistent"):
        expand(date(2026, 3, 29), 150, 240, "Europe/Berlin")


def test_midnight_and_cross_location_zones() -> None:
    start, end = expand(date(2026, 1, 1), 0, 1440, "Asia/Kathmandu")
    assert start == datetime(2025, 12, 31, 18, 15, tzinfo=UTC)
    assert (end - start).total_seconds() == 86400
    assert expand(date(2026, 1, 1), 0, 1440, "UTC")[0] != start


@pytest.mark.parametrize(
    "changes",
    [
        {"timezone": "No/SuchZone"},
        {"name": "   "},
        {"weekly": [{"weekday": 7, "start": 0, "end": 60}]},
        {"weekly": [{"weekday": 1, "start": 1380, "end": 60}]},
        {
            "weekly": [
                {"weekday": 1, "start": 60, "end": 180},
                {"weekday": 1, "start": 120, "end": 240},
            ]
        },
        {"exceptions": [{"day": "2026-12-25", "kind": "special", "intervals": []}]},
        {
            "exceptions": [
                {"day": "2026-12-25", "kind": "holiday", "intervals": [{"start": 60, "end": 120}]}
            ]
        },
        {"exceptions": [{"day": "2026-12-25", "kind": "holiday"}] * 2},
    ],
)
def test_invalid_rules(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        LocationInput.model_validate({"name": "Studio", "timezone": "UTC", **changes})


def test_policy_bounds_and_adjacent_windows() -> None:
    with pytest.raises(ValidationError):
        Policies(minimum_notice_minutes=1440, booking_horizon_days=1)
    with pytest.raises(ValidationError):
        Policies(buffer_before_minutes=-1)
    LocationInput.model_validate(
        {
            "name": "Studio",
            "timezone": "UTC",
            "weekly": [
                {"weekday": 0, "start": 0, "end": 60},
                {"weekday": 0, "start": 60, "end": 1440},
            ],
        }
    )
