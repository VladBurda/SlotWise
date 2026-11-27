import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type User } from '@/features/account/api';
import { localDay, slotLabel } from '@/features/bookings/contracts';
import { useRequestAction } from '@/features/bookings/useBookingAction';
import {
  customerBooking,
  publicAvailability,
  type CustomerBooking,
  type PortalCatalog,
} from './contracts';

export function CustomerEditor({
  slug,
  catalog,
  user,
  initial,
  onSaved,
  onClose,
}: {
  slug: string;
  catalog: PortalCatalog;
  user?: User;
  initial?: CustomerBooking;
  onSaved: (booking: CustomerBooking) => void;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [locationId, setLocation] = useState(initial?.location_id ?? '');
  const [serviceId, setService] = useState(initial?.service_id ?? '');
  const [employee, setEmployee] = useState('');
  const [duration, setDuration] = useState(
    initial
      ? (Date.parse(initial.ends_at) - Date.parse(initial.starts_at)) / 60000
      : 30,
  );
  const location = catalog.locations.find((item) => item.id === locationId);
  const service = catalog.services.find((item) => item.id === serviceId);
  const [day, setDay] = useState(
    localDay(
      initial?.starts_at ?? new Date().toISOString(),
      catalog.locations.find((item) => item.id === initial?.location_id)
        ?.timezone ?? 'UTC',
    ),
  );
  const [name, setName] = useState(initial?.customer_name ?? user?.name ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const reset = () => {
    setSearch('');
    setSelected(null);
  };
  const slots = useQuery({
    queryKey: ['public-availability', slug, user?.id, search],
    enabled: Boolean(search),
    retry: false,
    queryFn: async () =>
      publicAvailability.parse(
        await api(
          `/public/${slug}/${initial ? 'my-availability' : 'availability'}?${search}`,
          'GET',
          undefined,
          Boolean(user),
        ),
      ),
  });
  const action = useRequestAction(
    onSaved,
    () => {
      setSelected(null);
      void cache.invalidateQueries({ queryKey: ['public-availability', slug] });
      void cache.invalidateQueries({ queryKey: ['customer-bookings', slug] });
    },
    customerBooking.parse,
  );
  return (
    <section
      className="panel settings-form"
      aria-label={initial ? 'Change your appointment' : 'Book an appointment'}
    >
      <h2>
        {initial ? 'Change your appointment' : 'Choose a service and time'}
      </h2>
      <p>
        {catalog.cancellation.allowed
          ? `Changes and cancellations require at least ${catalog.cancellation.notice_minutes} minutes of notice before your appointment.`
          : 'This business does not permit online changes or cancellations.'}
      </p>
      {initial && (
        <p>Your current booking stays reserved until the change succeeds.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSelected(null);
          const params = new URLSearchParams({
            location_id: locationId,
            service_id: serviceId,
            duration_minutes: String(duration),
            start: day,
            limit: '500',
          });
          if (employee) params.set('employee_id', employee);
          if (initial) params.set('exclude_booking_id', initial.id);
          if (search === params.toString()) void slots.refetch();
          else setSearch(params.toString());
        }}
      >
        <fieldset disabled={action.locked}>
          <div className="catalog-row">
            <label>
              Location
              <select
                required
                value={locationId}
                onChange={(event) => {
                  setLocation(event.target.value);
                  setService('');
                  setEmployee('');
                  reset();
                }}
              >
                <option value="">Choose a location</option>
                {catalog.locations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service
              <select
                required
                value={serviceId}
                onChange={(event) => {
                  setService(event.target.value);
                  setDuration(
                    catalog.services.find(
                      (item) => item.id === event.target.value,
                    )?.duration_minutes ?? 30,
                  );
                  reset();
                }}
              >
                <option value="">Choose a service</option>
                {catalog.services
                  .filter((item) => item.location_ids.includes(locationId))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                required
                min={service?.duration_minutes ?? 5}
                max={service?.maximum_duration_minutes ?? 1440}
                step={service?.duration_step_minutes ?? 5}
                value={duration}
                onChange={(event) => {
                  setDuration(Number(event.target.value));
                  reset();
                }}
              />
            </label>
            <label>
              Staff preference
              <select
                value={employee}
                onChange={(event) => {
                  setEmployee(event.target.value);
                  reset();
                }}
              >
                <option value="">Any available staff member</option>
                {catalog.staff
                  .filter((item) => item.location_id === locationId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Date at location
              <input
                type="date"
                required
                min="1901-01-01"
                max="2099-12-31"
                value={day}
                onChange={(event) => {
                  setDay(event.target.value);
                  reset();
                }}
              />
            </label>
          </div>
          {service && (
            <p>
              {service.description && `${service.description} · `}
              {new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: service.currency,
              }).format(
                service.price_minor / (service.currency === 'JPY' ? 1 : 100),
              )}
            </p>
          )}
          {location && (
            <p>
              {location.address && `${location.address} · `}Times shown in{' '}
              {location.timezone}
            </p>
          )}
          <Button disabled={!service || !location || slots.isFetching}>
            Find available times
          </Button>
        </fieldset>
      </form>
      {slots.isFetching && <p role="status">Checking available times…</p>}
      {slots.isError && <p role="alert">{errorMessage(slots.error)}</p>}
      {search && slots.data && !slots.isFetching && (
        <>
          <p>
            {slots.data.truncated
              ? 'Showing the first 500 times; narrow your search if needed.'
              : 'Availability is checked again when you confirm.'}
          </p>
          {!slots.data.slots.length && (
            <p role="status">
              No available times. Try another date or staff preference.
            </p>
          )}
          <div
            className="booking-slots"
            role="group"
            aria-label="Available appointment times"
          >
            {slots.data.slots.map((slot) => (
              <Button
                key={slot.starts_at}
                variant={selected === slot.starts_at ? 'default' : 'outline'}
                aria-pressed={selected === slot.starts_at}
                disabled={action.locked}
                onClick={() => setSelected(slot.starts_at)}
              >
                {slotLabel(slot.starts_at, slots.data.timezone)}
              </Button>
            ))}
          </div>
        </>
      )}
      {selected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            action.submit(
              `/public/${slug}/bookings${initial ? `/${initial.id}/reschedule` : ''}`,
              {
                service_id: serviceId,
                location_id: locationId,
                starts_at: selected,
                duration_minutes: duration,
                customer_name: name.trim(),
                ...(employee ? { employee_id: employee } : {}),
                ...(initial ? { version: initial.version } : {}),
              },
            );
          }}
        >
          <fieldset disabled={action.locked || !user?.verified}>
            <h3>Review your appointment</h3>
            <p>
              {service?.name} ·{' '}
              {slotLabel(selected, location?.timezone ?? 'UTC')} · {duration}{' '}
              minutes
            </p>
            <label>
              Contact name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p>
              Email:{' '}
              {user?.email ??
                'Verify your email below to confirm this appointment.'}
            </p>
            <Button disabled={!name.trim()}>
              {initial ? 'Confirm appointment change' : 'Confirm my booking'}
            </Button>
          </fieldset>
        </form>
      )}
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      {action.isPending && <p role="status">Saving your appointment…</p>}
      {action.locked && !action.isPending && (
        <div role="alert">
          <p>
            The result is uncertain. Keep this page open and retry the same
            request.
          </p>
          <Button onClick={action.retryCommand}>
            Retry booking confirmation
          </Button>
        </div>
      )}
      {user && (
        <Button variant="outline" disabled={action.locked} onClick={onClose}>
          {initial ? 'Keep current appointment' : 'View my appointments'}
        </Button>
      )}
    </section>
  );
}
