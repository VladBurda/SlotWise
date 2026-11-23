import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { slotLabel, type Booking } from '@/features/bookings/contracts';
import type { CatalogItem } from '@/features/catalog/contracts';
import { TimelineCard } from './TimelineCard';
import type { CalendarProposal } from './CalendarChange';
import {
  axisTicks,
  daySpan,
  timelineRows,
  type TimelineKind,
} from './timelineLayout';

export function Timeline({
  day,
  timezone,
  kind,
  items,
  bookings,
  locationId,
  selectedId,
  onSelect,
  onPropose,
}: {
  day: string;
  timezone: string;
  kind: TimelineKind;
  items: CatalogItem[];
  bookings: Booking[];
  locationId: string;
  selectedId: string;
  onSelect: (id: string) => void;
  onPropose?: (proposal: CalendarProposal) => void;
}) {
  const span = useMemo(() => daySpan(day, timezone), [day, timezone]);
  const rows = useMemo(
    () => timelineRows(items, bookings, kind, span, locationId, selectedId),
    [items, bookings, kind, span, locationId, selectedId],
  );
  const ticks = useMemo(() => axisTicks(span, timezone), [span, timezone]);
  const [limit, setLimit] = useState(20);
  const scroll = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const duration = span.end - span.start;
  useEffect(() => {
    const starts = rows.flatMap((row) =>
      row.entries.map((entry) => entry.start),
    );
    if (!scroll.current || !track.current || !starts.length || duration <= 0)
      return;
    const first = starts.reduce((a, b) => Math.min(a, b));
    scroll.current.scrollLeft = Math.max(
      0,
      ((first - span.start) / duration) * track.current.clientWidth - 50,
    );
  }, [rows, span.start, duration]);
  if (duration <= 0)
    return <p role="status">This local date does not occur in {timezone}.</p>;
  const shown = rows.slice(0, limit);
  const list = [
    ...new Map(
      shown.flatMap((r) =>
        r.entries.map((entry) => [entry.booking.id, entry.booking] as const),
      ),
    ).values(),
  ].sort(
    (a, b) =>
      a.slot.starts_at.localeCompare(b.slot.starts_at) ||
      a.id.localeCompare(b.id),
  );
  const heading = kind === 'staff' ? 'Staff timeline' : 'Resource timeline';
  return (
    <div className="timeline">
      <h3>{heading}</h3>
      {onPropose && (
        <p id="timeline-edit-help">
          Drag a confirmed booking to move it in 15-minute steps; drag its ↔
          handle to change duration. With a booking focused, use Left/Right to
          move or Shift+Left/Right to resize. Review each change before saving.
          Use appointment details for button controls.
        </p>
      )}
      <p id="timeline-help">
        {duration / 3600000} elapsed hours · {timezone}. Shaded spans include
        buffers for confirmed bookings. Empty space does not mean bookable time.
        Scroll horizontally to explore the day.
      </p>
      {rows.length === 0 && (
        <p role="status">
          No {kind === 'staff' ? 'staff' : 'resources'} match these filters.
        </p>
      )}
      {rows.length > 0 && (
        <div
          ref={scroll}
          className="timeline-scroll"
          tabIndex={0}
          role="region"
          aria-label={heading}
          aria-describedby="timeline-help"
        >
          <div className="timeline-canvas">
            <div className="timeline-row timeline-heading">
              <div className="timeline-label">
                {kind === 'staff' ? 'Staff member' : 'Resource'}
              </div>
              <div ref={track} className="timeline-axis">
                {ticks.map((tick, index) => (
                  <div
                    className={`timeline-tick ${index === ticks.length - 1 ? 'last' : ''}`}
                    key={tick.at}
                    style={{ left: `${tick.percent}%` }}
                  >
                    <span>{tick.time}</span>
                    <small>{tick.offset}</small>
                  </div>
                ))}
              </div>
            </div>
            {shown.map((row) => (
              <div key={row.id} className="timeline-row">
                <div className="timeline-label">
                  <strong>{row.name}</strong>
                  {!row.active && <span>Inactive / historical</span>}
                  {row.capacity !== undefined && (
                    <span>Capacity {row.capacity}</span>
                  )}
                </div>
                <div
                  className="timeline-track"
                  style={{ height: `${row.lanes * 64 + 12}px` }}
                >
                  {ticks.map((tick) => (
                    <i
                      key={tick.at}
                      className="timeline-line"
                      style={{ left: `${tick.percent}%` }}
                      aria-hidden="true"
                    />
                  ))}
                  {row.entries.length === 0 && (
                    <span className="timeline-empty">No appointments</span>
                  )}
                  {row.entries.map((entry) => {
                    const serviceLeft =
                      (Math.max(0, entry.serviceStart - entry.start) /
                        (entry.end - entry.start)) *
                      100;
                    const serviceWidth =
                      (Math.max(
                        0,
                        Math.min(entry.serviceEnd, entry.end) -
                          Math.max(entry.serviceStart, entry.start),
                      ) /
                        (entry.end - entry.start)) *
                      100;
                    const label = `${entry.booking.customer_name} · ${entry.booking.service_name} · ${slotLabel(entry.booking.slot.starts_at, timezone)} – ${slotLabel(entry.booking.slot.ends_at, timezone)} · ${entry.units} unit${entry.units === 1 ? '' : 's'} · ${entry.booking.status}`;
                    return (
                      <TimelineCard
                        booking={entry.booking}
                        elapsed={duration}
                        step={(() => {
                          const service = items.find(
                            (item) => item.id === entry.booking.service_id,
                          )?.data;
                          return service?.kind === 'services'
                            ? service.duration_step_minutes
                            : 5;
                        })()}
                        onPropose={onPropose}
                        type="button"
                        key={entry.booking.id}
                        className={`timeline-booking ${entry.booking.status}`}
                        style={{
                          left: `${((entry.start - span.start) / duration) * 100}%`,
                          width: `${((entry.end - entry.start) / duration) * 100}%`,
                          top: `${entry.lane * 64 + 6}px`,
                        }}
                        aria-label={label}
                        title={label}
                        onClick={() => onSelect(entry.booking.id)}
                      >
                        {serviceWidth > 0 && (
                          <span
                            className="timeline-service"
                            style={{
                              left: `${serviceLeft}%`,
                              width: `${serviceWidth}%`,
                            }}
                            aria-hidden="true"
                          />
                        )}
                        <span className="timeline-booking-text">
                          {entry.booking.customer_name}
                          <small>
                            {entry.units} unit{entry.units === 1 ? '' : 's'}
                            {entry.booking.status === 'cancelled' &&
                              ' · Cancelled'}
                            {serviceWidth === 0 && ' · Buffer only'}
                          </small>
                        </span>
                      </TimelineCard>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {rows.length > limit && (
        <div className="form-actions">
          <p>
            Showing {shown.length} of {rows.length} rows.
          </p>
          <Button variant="outline" onClick={() => setLimit(limit + 20)}>
            Show more rows
          </Button>
        </div>
      )}
      {list.length > 0 && (
        <details className="timeline-list">
          <summary>Appointment list for displayed rows ({list.length})</summary>
          <ul>
            {list.map((booking) => (
              <li key={booking.id}>
                <button type="button" onClick={() => onSelect(booking.id)}>
                  {booking.customer_name} · {booking.service_name} ·{' '}
                  {slotLabel(booking.slot.starts_at, timezone)} ·{' '}
                  {booking.status}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
