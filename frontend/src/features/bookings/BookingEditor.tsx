import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/features/account/api';
import type { CatalogItem } from '@/features/catalog/contracts';
import type { Location } from '@/features/business/contracts';
import {
  availabilitySchema,
  localDay,
  slotLabel,
  type Booking,
  type Slot,
} from './contracts';
import { useBookingAction } from './useBookingAction';

export function BookingEditor({
  workspaceId,
  items,
  locations,
  initial,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  items: CatalogItem[];
  locations: Location[];
  initial?: Booking;
  onSaved: (booking: Booking) => void;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const services = items.filter(
    (i) => i.data.kind === 'services' && i.data.active,
  );
  const [serviceId, setServiceId] = useState(initial?.service_id ?? '');
  const [locationId, setLocationId] = useState(initial?.location_id ?? '');
  const location = locations.find((l) => l.id === locationId);
  const service = services.find((s) => s.id === serviceId)?.data;
  const [duration, setDuration] = useState(
    initial
      ? (Date.parse(initial.slot.ends_at) -
          Date.parse(initial.slot.starts_at)) /
          60000
      : 30,
  );
  const [customer, setCustomer] = useState(initial?.customer_name ?? '');
  const [employee, setEmployee] = useState('');
  const [day, setDay] = useState(
    localDay(
      initial?.slot.starts_at ?? new Date().toISOString(),
      location?.timezone ?? 'UTC',
    ),
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Slot | null>(null);
  const reset = () => {
    setSearch('');
    setSelected(null);
  };
  const slots = useQuery({
    queryKey: ['availability', workspaceId, search],
    enabled: Boolean(search),
    retry: false,
    queryFn: async () =>
      availabilitySchema.parse(
        await api(`/workspaces/${workspaceId}/availability?${search}`),
      ),
  });
  const action = useBookingAction(onSaved, () => {
    setSelected(null);
    void cache.invalidateQueries({ queryKey: ['availability', workspaceId] });
    void cache.invalidateQueries({ queryKey: ['bookings', workspaceId] });
  });
  const names = new Map(items.map((i) => [i.id, i.data.name]));
  return (
    <section
      className="panel settings-form booking-editor"
      aria-label={initial ? 'Reschedule appointment' : 'New appointment'}
    >
      <h2>{initial ? 'Reschedule appointment' : 'New appointment'}</h2>
      {initial && (
        <p>
          Current time:{' '}
          {slotLabel(initial.slot.starts_at, location?.timezone ?? 'UTC')}. Your
          original appointment stays reserved until the change succeeds.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSelected(null);
          const params = new URLSearchParams({
            service_id: serviceId,
            location_id: locationId,
            start: day,
            duration_minutes: String(duration),
            limit: '500',
          });
          if (employee) params.set('employee_id', employee);
          if (initial) params.set('exclude_booking_id', initial.id);
          const value = params.toString();
          if (search === value) void slots.refetch();
          else setSearch(value);
        }}
      >
        <fieldset disabled={action.locked}>
          <div className="catalog-row">
            <label>
              Service
              <select
                required
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  setLocationId('');
                  setEmployee('');
                  reset();
                  const next = services.find(
                    (s) => s.id === e.target.value,
                  )?.data;
                  if (next?.kind === 'services')
                    setDuration(next.duration_minutes);
                }}
              >
                <option value="">Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.data.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Location
              <select
                required
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  setEmployee('');
                  reset();
                }}
              >
                <option value="">Choose a location</option>
                {locations
                  .filter(
                    (l) =>
                      l.active &&
                      l.id !== undefined &&
                      service?.kind === 'services' &&
                      service.location_ids.includes(l.id),
                  )
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                required
                min={
                  service?.kind === 'services' ? service.duration_minutes : 5
                }
                max={
                  service?.kind === 'services'
                    ? service.maximum_duration_minutes
                    : 1440
                }
                step={
                  service?.kind === 'services'
                    ? service.duration_step_minutes
                    : 5
                }
                value={duration}
                onChange={(e) => {
                  setDuration(Number(e.target.value));
                  reset();
                }}
              />
            </label>
          </div>
          <div className="catalog-row">
            <label>
              Date at location
              <input
                type="date"
                required
                min="1901-01-01"
                max="2099-12-31"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Staff preference
              <select
                value={employee}
                onChange={(e) => {
                  setEmployee(e.target.value);
                  reset();
                }}
              >
                <option value="">Any eligible staff member</option>
                {items
                  .filter(
                    (i) =>
                      i.data.kind === 'staff' &&
                      i.data.active &&
                      i.data.location_id === locationId,
                  )
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.data.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p>
            Times are shown in{' '}
            <strong>
              {location?.timezone ?? 'the selected location’s timezone'}
            </strong>
            . Availability is checked again when you confirm.
          </p>
          <Button disabled={!serviceId || !locationId || slots.isFetching}>
            Find available times
          </Button>
        </fieldset>
      </form>
      {search && slots.isFetching && (
        <p role="status">Checking availability…</p>
      )}
      {search && slots.isError && (
        <p role="alert">{errorMessage(slots.error)}</p>
      )}
      {search && slots.data && !slots.isFetching && (
        <>
          {slots.data.warnings.length > 0 && (
            <p role="alert">
              Some schedules could not be evaluated. Review scheduling setup
              before booking.
            </p>
          )}
          {slots.data.truncated && (
            <p role="status">
              Showing the first 500 available times. Choose a staff member to
              narrow the results.
            </p>
          )}
          {slots.data.slots.length === 0 && (
            <p role="status">
              No available times. Try another date, duration, or staff
              preference.
            </p>
          )}
          <div
            className="booking-slots"
            role="group"
            aria-label="Available times"
          >
            {slots.data.slots.map((slot) => (
              <Button
                key={slot.starts_at}
                type="button"
                disabled={action.locked}
                variant={
                  selected?.starts_at === slot.starts_at ? 'default' : 'outline'
                }
                aria-pressed={selected?.starts_at === slot.starts_at}
                onClick={() => setSelected(slot)}
              >
                {slotLabel(slot.starts_at, slots.data.timezone)}
              </Button>
            ))}
          </div>
        </>
      )}
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.submit(
              `/workspaces/${workspaceId}/bookings${initial ? `/${initial.id}/reschedule` : ''}`,
              {
                service_id: serviceId,
                location_id: locationId,
                starts_at: selected.starts_at,
                duration_minutes: duration,
                employee_id: selected.employee_id,
                customer_name: customer.trim(),
                ...(initial ? { version: initial.version } : {}),
              },
            );
          }}
        >
          <fieldset disabled={action.locked}>
            <h3>Review appointment</h3>
            <p>
              {slotLabel(selected.starts_at, location?.timezone ?? 'UTC')} –{' '}
              {slotLabel(selected.ends_at, location?.timezone ?? 'UTC')}
            </p>
            <p>
              Staff: {names.get(selected.employee_id) ?? 'Assigned staff'}
              {selected.resources.length > 0 &&
                ` · Resources: ${selected.resources.map((r) => names.get(r.resource_id) ?? 'Assigned resource').join(', ')}`}
            </p>
            {service?.kind === 'services' && (
              <p>
                {new Intl.NumberFormat(undefined, {
                  style: 'currency',
                  currency: service.currency,
                }).format(
                  service.price_minor / (service.currency === 'JPY' ? 1 : 100),
                )}
              </p>
            )}
            <label>
              Customer name
              <input
                required
                maxLength={100}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </label>
            <Button disabled={!customer.trim() || action.locked}>
              {initial ? 'Confirm reschedule' : 'Confirm booking'}
            </Button>
          </fieldset>
        </form>
      )}
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      {action.locked && !action.isPending && (
        <div role="alert">
          <p>
            The result is uncertain. Keep this page open and retry the same
            request to avoid a duplicate appointment.
          </p>
          <Button onClick={action.retryCommand}>Retry confirmation</Button>
        </div>
      )}
      {action.isPending && <p role="status">Saving appointment…</p>}
      <Button
        type="button"
        variant="outline"
        disabled={action.locked}
        onClick={onClose}
      >
        Close editor
      </Button>
    </section>
  );
}
