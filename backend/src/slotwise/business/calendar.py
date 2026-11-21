"""Pure civil-time expansion; no persistence or HTTP dependencies."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def instants(day: date, minute: int, zone: str) -> tuple[datetime, ...]:
    local = datetime.combine(day, time()) + timedelta(minutes=minute)
    tz = ZoneInfo(zone)
    candidates = {local.replace(tzinfo=tz, fold=fold).astimezone(UTC) for fold in (0, 1)}
    return tuple(
        sorted(value for value in candidates if value.astimezone(tz).replace(tzinfo=None) == local)
    )


def expand(day: date, start: int, end: int, zone: str) -> tuple[datetime, datetime]:
    starts, ends = instants(day, start, zone), instants(day, end, zone)
    if not starts or not ends:
        raise ValueError(
            "A boundary falls in a nonexistent local time; add special hours for this date"
        )
    # A civil opening spanning a repeated hour remains continuously open through both folds.
    return starts[0], ends[-1]
