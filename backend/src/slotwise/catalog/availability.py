"""Pure configuration preview, not appointment availability."""

from datetime import date, datetime

from slotwise.business.calendar import expand
from slotwise.business.schemas import Interval, LocationView
from slotwise.catalog.schemas import Availability

Window = tuple[datetime, datetime]


def merge(windows: list[Window]) -> list[Window]:
    result: list[Window] = []
    for start, end in sorted(windows):
        if result and start <= result[-1][1]:
            result[-1] = result[-1][0], max(end, result[-1][1])
        else:
            result.append((start, end))
    return result


def subtract(windows: list[Window], blocks: list[Window]) -> list[Window]:
    result = merge(windows)
    for start, end in blocks:
        remaining: list[Window] = []
        for a, b in result:
            if end <= a or start >= b:
                remaining.append((a, b))
            else:
                if a < start:
                    remaining.append((a, start))
                if end < b:
                    remaining.append((end, b))
        result = remaining
    return result


def operating_windows(
    day: date, location: LocationView, availability: Availability
) -> list[Window]:
    if not location.active:
        return []
    exception = next((e for e in availability.exceptions if e.day == day), None)
    work: list[Interval] = (
        list(exception.intervals)
        if exception
        else [w for w in availability.weekly if w.weekday == day.weekday()]
    )
    business_exception = next((e for e in location.exceptions if e.day == day), None)
    opening: list[Interval] = (
        list(business_exception.intervals)
        if business_exception
        else [w for w in location.weekly if w.weekday == day.weekday()]
    )
    work_utc = [expand(day, w.start, w.end, location.timezone) for w in work]
    open_utc = [expand(day, w.start, w.end, location.timezone) for w in opening]
    intersections = [
        (max(a, c), min(b, d)) for a, b in work_utc for c, d in open_utc if max(a, c) < min(b, d)
    ]
    # A dated exception replaces weekly work AND weekly breaks.
    breaks = (
        []
        if exception
        else [
            expand(day, w.start, w.end, location.timezone)
            for w in availability.breaks
            if w.weekday == day.weekday()
        ]
    )
    return subtract(intersections, breaks + [(w.start, w.end) for w in availability.unavailable])
