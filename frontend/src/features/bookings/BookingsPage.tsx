import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Workspace } from '@/features/account/api';
import { loadBookingConfig } from './data';
import { BookingEditor } from './BookingEditor';
import { bookingSchema, slotLabel, type Booking } from './contracts';
import { useBookingAction } from './useBookingAction';

function CancelBooking({
  booking,
  workspaceId,
  onSaved,
  onClose,
}: {
  booking: Booking;
  workspaceId: string;
  onSaved: (b: Booking) => void;
  onClose: () => void;
}) {
  const action = useBookingAction(onSaved, () => {});
  return (
    <section className="panel" aria-label="Cancel appointment">
      <h2>Cancel {booking.customer_name}’s appointment?</h2>
      <p>
        This releases the reserved staff and resources. The appointment remains
        in your history.
      </p>
      <div className="form-actions">
        <Button
          disabled={action.locked}
          onClick={() =>
            action.submit(
              `/workspaces/${workspaceId}/bookings/${booking.id}/cancel`,
              { version: booking.version },
            )
          }
        >
          Confirm cancellation
        </Button>
        <Button variant="outline" disabled={action.locked} onClick={onClose}>
          Keep appointment
        </Button>
      </div>
      {action.isPending && <p role="status">Cancelling appointment…</p>}
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      {action.locked && !action.isPending && (
        <>
          <p role="alert">
            The result is uncertain. Retry this cancellation before leaving.
          </p>
          <Button onClick={action.retryCommand}>Retry cancellation</Button>
        </>
      )}
    </section>
  );
}

export function BookingsPage({ workspace }: { workspace: Workspace }) {
  const cache = useQueryClient();
  const root = `/workspaces/${workspace.id}`;
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<Booking | 'new' | null>(null);
  const [cancel, setCancel] = useState<Booking | null>(null);
  const [notice, setNotice] = useState('');
  const config = useQuery({
    queryKey: ['booking-config', workspace.id],
    queryFn: () => loadBookingConfig(workspace.id),
  });
  const bookings = useQuery({
    queryKey: ['bookings', workspace.id, offset],
    queryFn: async () =>
      z
        .array(bookingSchema)
        .parse(await api(`${root}/bookings?offset=${offset}&limit=20`)),
  });
  const saved = (booking: Booking) => {
    setEditor(null);
    setCancel(null);
    setNotice(
      booking.status === 'cancelled'
        ? 'Appointment cancelled.'
        : `Appointment confirmed for ${booking.customer_name}.`,
    );
    void cache.invalidateQueries({ queryKey: ['bookings', workspace.id] });
    void cache.invalidateQueries({ queryKey: ['calendar', workspace.id] });
    void cache.invalidateQueries({ queryKey: ['availability', workspace.id] });
  };
  return (
    <div className="booking-page">
      <section className="panel">
        <div className="workspace-toolbar">
          <div>
            <p className="eyebrow">YOUR WORKDAY</p>
            <h2>Appointments</h2>
            <p>Book time for your customers, people, and resources.</p>
          </div>
          <Button
            disabled={!config.data || editor !== null || cancel !== null}
            onClick={() => {
              setNotice('');
              setEditor('new');
            }}
          >
            New appointment
          </Button>
        </div>
      </section>
      {notice && (
        <p role="status" className="form-success">
          {notice}
        </p>
      )}
      {config.isPending && <p role="status">Loading services and locations…</p>}
      {config.isError && (
        <div role="alert">
          {errorMessage(config.error)}{' '}
          <Button onClick={() => void config.refetch()}>
            Retry setup loading
          </Button>
        </div>
      )}
      {editor && config.data && (
        <BookingEditor
          key={editor === 'new' ? 'new' : editor.id}
          workspaceId={workspace.id}
          items={config.data.items}
          locations={config.data.locations}
          initial={editor === 'new' ? undefined : editor}
          onSaved={saved}
          onClose={() => setEditor(null)}
        />
      )}
      {cancel && (
        <CancelBooking
          key={cancel.id}
          booking={cancel}
          workspaceId={workspace.id}
          onSaved={saved}
          onClose={() => {
            setCancel(null);
            void bookings.refetch();
          }}
        />
      )}
      <section className="panel" aria-label="Appointment list">
        <div className="workspace-toolbar">
          <h2>Appointment history</h2>
          <Button
            variant="outline"
            onClick={() => void bookings.refetch()}
            disabled={bookings.isFetching}
          >
            Refresh appointments
          </Button>
        </div>
        {bookings.isPending && <p role="status">Loading appointments…</p>}
        {bookings.isError && <p role="alert">{errorMessage(bookings.error)}</p>}
        {bookings.data?.length === 0 && (
          <p>
            No appointments on this page. Choose New appointment to get started.
          </p>
        )}
        <ul className="booking-list">
          {bookings.data?.map((booking) => {
            const location = config.data?.locations.find(
              (l) => l.id === booking.location_id,
            );
            const zone = location?.timezone ?? 'UTC';
            return (
              <li key={booking.id}>
                <div>
                  <h3>{booking.customer_name}</h3>
                  <p>
                    {booking.service_name} · {location?.name ?? 'Location'}
                  </p>
                  <p>
                    {slotLabel(booking.slot.starts_at, zone)} · {zone}
                  </p>
                  <span
                    className={
                      booking.status === 'confirmed' ? 'badge success' : 'badge'
                    }
                  >
                    {booking.status}
                  </span>
                </div>
                {booking.status === 'confirmed' && (
                  <div className="form-actions">
                    <Button
                      variant="outline"
                      disabled={
                        !config.data || editor !== null || cancel !== null
                      }
                      onClick={() => {
                        setNotice('');
                        setEditor(booking);
                      }}
                    >
                      Reschedule
                    </Button>
                    <Button
                      variant="outline"
                      disabled={editor !== null || cancel !== null}
                      onClick={() => {
                        setNotice('');
                        setCancel(booking);
                      }}
                    >
                      Cancel appointment
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={offset === 0 || bookings.isFetching}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous page
          </Button>
          <span>Page {offset / 20 + 1}</span>
          <Button
            variant="outline"
            disabled={bookings.data?.length !== 20 || bookings.isFetching}
            onClick={() => setOffset(offset + 20)}
          >
            Next page
          </Button>
        </div>
      </section>
    </div>
  );
}
