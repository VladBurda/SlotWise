import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Workspace } from '@/features/account/api';
import {
  bookingSchema,
  localDay,
  slotLabel,
  type Booking,
} from '@/features/bookings/contracts';
import { loadBookingConfig } from '@/features/bookings/data';
import { Timeline } from './Timeline';
import {
  calendarDays,
  dayTitle,
  overlapsDay,
  rangeParams,
  shiftDay,
  type CalendarView,
} from './dates';

export function CalendarPage({ workspace }: { workspace: Workspace }) {
  const [view, setView] = useState<CalendarView>('week');
  const [day, setDay] = useState(
    localDay(new Date().toISOString(), workspace.timezone),
  );
  const [locationId, setLocationId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [status, setStatus] = useState('confirmed');
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const config = useQuery({
    queryKey: ['booking-config', workspace.id],
    queryFn: () => loadBookingConfig(workspace.id),
  });
  const location = config.data?.locations.find((l) => l.id === locationId);
  const timezone = location?.timezone ?? workspace.timezone;
  const days = calendarDays(day, view);
  const query = days.length
    ? rangeParams(days, view === 'staff' || view === 'resources')
    : new URLSearchParams();
  if (locationId) query.set('location_id', locationId);
  if (employeeId) query.set('employee_id', employeeId);
  if (resourceId) query.set('resource_id', resourceId);
  if (status) query.set('status', status);
  const search = query.toString();
  const bookings = useQuery({
    queryKey: ['calendar', workspace.id, search],
    enabled: days.length > 0,
    retry: false,
    queryFn: async () => {
      const all: Booking[] = [];
      for (let offset = 0; offset < 5000; offset += 100) {
        const page = z
          .array(bookingSchema)
          .parse(
            await api(
              `/workspaces/${workspace.id}/bookings?${search}&offset=${offset}&limit=100`,
            ),
          );
        all.push(...page);
        if (page.length < 100) return all;
      }
      throw new Error(
        'Too many appointments. Choose a shorter view or narrow the filters.',
      );
    },
  });
  const active = bookings.data?.find((b) => b.id === selected);
  useEffect(() => {
    if (active && !dialog.current?.open) dialog.current?.showModal();
    else if (!active && dialog.current?.open) dialog.current.close();
  }, [active]);
  const names = new Map(config.data?.items.map((i) => [i.id, i.data.name]));
  const move = (direction: number) => {
    if (!days.length) return;
    if (view === 'month') {
      const next = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + direction);
      setDay(next.toISOString().slice(0, 10));
    } else
      setDay(
        shiftDay(
          day,
          direction * (view === 'week' || view === 'agenda' ? 7 : 1),
        ),
      );
    setSelected(null);
  };
  return (
    <section className="panel calendar-page" aria-label="Appointment calendar">
      <div className="workspace-toolbar">
        <div>
          <p className="eyebrow">PLAN YOUR WORKDAY</p>
          <h2>Calendar</h2>
          <p>
            Appointments displayed in <strong>{timezone}</strong>.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={bookings.isFetching || !days.length}
          onClick={() => void bookings.refetch()}
        >
          Refresh calendar
        </Button>
      </div>
      <div className="calendar-controls">
        <label>
          Calendar view
          <select
            value={view}
            onChange={(e) => {
              setView(e.target.value as CalendarView);
              setSelected(null);
            }}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="agenda">Agenda</option>
            <option value="staff">Staff timeline</option>
            <option value="resources">Resource timeline</option>
          </select>
        </label>
        <label>
          Calendar date
          <input
            type="date"
            min="1901-01-01"
            max="2099-12-31"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setSelected(null);
            }}
          />
        </label>
        <label>
          Calendar location
          <select
            value={locationId}
            onChange={(e) => {
              setLocationId(e.target.value);
              setEmployeeId('');
              setResourceId('');
              setSelected(null);
            }}
          >
            <option value="">All locations</option>
            {config.data?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {!l.active && ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Calendar staff
          <select
            value={employeeId}
            onChange={(e) => {
              setEmployeeId(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All staff</option>
            {config.data?.items
              .filter(
                (i) =>
                  i.data.kind === 'staff' &&
                  (!locationId || i.data.location_id === locationId),
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.data.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Calendar resource
          <select
            value={resourceId}
            onChange={(e) => {
              setResourceId(e.target.value);
              setSelected(null);
            }}
          >
            <option value="">All resources</option>
            {config.data?.items
              .filter(
                (i) =>
                  i.data.kind === 'resources' &&
                  (!locationId || i.data.location_id === locationId),
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.data.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Appointment status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSelected(null);
            }}
          >
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All statuses</option>
          </select>
        </label>
      </div>
      <div className="form-actions">
        <Button
          variant="outline"
          disabled={!days.length || day <= '1901-02-01'}
          onClick={() => move(-1)}
        >
          Previous period
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDay(localDay(new Date().toISOString(), timezone));
            setSelected(null);
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          disabled={!days.length || day >= '2099-11-30'}
          onClick={() => move(1)}
        >
          Next period
        </Button>
      </div>
      {config.isError && (
        <div role="alert">
          {errorMessage(config.error)}{' '}
          <Button variant="outline" onClick={() => void config.refetch()}>
            Retry calendar setup
          </Button>
        </div>
      )}
      {!days.length && <p role="alert">Choose a valid calendar date.</p>}
      {days.length > 0 && bookings.isFetching && (
        <p role="status">Loading calendar…</p>
      )}
      {bookings.isError && <p role="alert">{errorMessage(bookings.error)}</p>}
      {bookings.data && !bookings.isError && days.length > 0 && (
        <>
          {view === 'staff' || view === 'resources' ? (
            <Timeline
              key={`${view}:${day}:${locationId}:${employeeId}:${resourceId}:${status}`}
              day={day}
              timezone={timezone}
              kind={view}
              items={config.data?.items ?? []}
              bookings={bookings.data}
              locationId={locationId}
              selectedId={view === 'staff' ? employeeId : resourceId}
              onSelect={setSelected}
            />
          ) : (
            <>
              <p className="calendar-caption">
                {dayTitle(days[0]!)} – {dayTitle(days.at(-1)!)} ·{' '}
                {new Date(day).getUTCFullYear()} ·{' '}
                {
                  bookings.data.filter((b) =>
                    days.some((d) => overlapsDay(b, d, timezone)),
                  ).length
                }{' '}
                appointments
              </p>
              <div
                className={`calendar-grid calendar-${view}`}
                aria-label={`${view} appointments`}
              >
                {days.map((date) => {
                  const entries = bookings.data.filter((b) =>
                    overlapsDay(b, date, timezone),
                  );
                  return (
                    <section
                      key={date}
                      className={
                        date === localDay(new Date().toISOString(), timezone)
                          ? 'calendar-day today'
                          : 'calendar-day'
                      }
                      aria-label={date}
                    >
                      <h3>{dayTitle(date)}</h3>
                      {entries.length === 0 && (
                        <p className="calendar-empty">No appointments</p>
                      )}
                      {entries.map((booking) => (
                        <button
                          type="button"
                          className={`calendar-appointment ${booking.status}`}
                          key={booking.id}
                          aria-pressed={selected === booking.id}
                          onClick={() => setSelected(booking.id)}
                        >
                          <strong>{booking.customer_name}</strong>
                          <span>{booking.service_name}</span>
                          <span>
                            {slotLabel(booking.slot.starts_at, timezone)}
                          </span>
                          {localDay(booking.slot.starts_at, timezone) !==
                            date && <span>Continues from previous day</span>}
                          {booking.status === 'cancelled' && (
                            <span>Cancelled</span>
                          )}
                        </button>
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      <dialog
        ref={dialog}
        className="calendar-details"
        aria-label="Appointment details"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
      >
        {active && (
          <>
            <h3>{active.customer_name}</h3>
            <p>
              {active.service_name} · {active.status}
            </p>
            <p>
              {slotLabel(active.slot.starts_at, timezone)} –{' '}
              {slotLabel(active.slot.ends_at, timezone)}
            </p>
            <p>
              Staff: {names.get(active.slot.employee_id) ?? 'Assigned staff'}
            </p>
            <p>
              Resources:{' '}
              {active.slot.resources
                .map((r) => names.get(r.resource_id) ?? 'Assigned resource')
                .join(', ') || 'None required'}
            </p>
            <p>Use Appointments to reschedule or cancel this booking.</p>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close details
            </Button>
          </>
        )}
      </dialog>
    </section>
  );
}
