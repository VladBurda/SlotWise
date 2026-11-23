import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/account/api';
import { slotLabel, type Booking } from '@/features/bookings/contracts';
import { useBookingAction } from '@/features/bookings/useBookingAction';

export type CalendarProposal = {
  booking: Booking;
  startsAt: string;
  duration: number;
};

export function proposeChange(
  booking: Booking,
  minutes: number,
  resize: boolean,
): CalendarProposal {
  const start = Date.parse(booking.slot.starts_at);
  const duration = (Date.parse(booking.slot.ends_at) - start) / 60000;
  return {
    booking,
    startsAt: new Date(start + (resize ? 0 : minutes * 60000)).toISOString(),
    duration: duration + (resize ? minutes : 0),
  };
}

export function CalendarChange({
  proposal,
  workspaceId,
  timezone,
  onClose,
}: {
  proposal: CalendarProposal;
  workspaceId: string;
  timezone: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cache = useQueryClient();
  const refresh = () => {
    for (const key of ['calendar', 'bookings', 'availability'])
      void cache.invalidateQueries({ queryKey: [key, workspaceId] });
  };
  const action = useBookingAction(() => {
    refresh();
    onClose();
  }, refresh);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const { booking, startsAt, duration } = proposal;
  return (
    <dialog
      ref={dialog}
      className="calendar-details"
      aria-label="Confirm calendar change"
      onCancel={(event) => {
        event.preventDefault();
        if (!action.locked) onClose();
      }}
    >
      <h3>Review calendar change</h3>
      <p>
        {booking.customer_name} · {booking.service_name}
      </p>
      <p>
        Current: {slotLabel(booking.slot.starts_at, timezone)} –{' '}
        {slotLabel(booking.slot.ends_at, timezone)}
      </p>
      <p>
        Proposed: {slotLabel(startsAt, timezone)} –{' '}
        {slotLabel(
          new Date(Date.parse(startsAt) + duration * 60000).toISOString(),
          timezone,
        )}{' '}
        ({duration} minutes)
      </p>
      <p>
        Your original time stays reserved until this change succeeds. Staff
        stays the same; resources are allocated again according to the service
        requirements.
      </p>
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      {action.locked && !action.isPending && (
        <div role="alert">
          <p>
            The result is uncertain. Keep this page open and retry the same
            request.
          </p>
          <Button onClick={action.retryCommand}>Retry calendar change</Button>
        </div>
      )}
      {action.isPending && <p role="status">Saving calendar change…</p>}
      <div className="form-actions">
        <Button
          disabled={action.locked || action.isError}
          onClick={() =>
            action.submit(
              `/workspaces/${workspaceId}/bookings/${booking.id}/reschedule`,
              {
                service_id: booking.service_id,
                location_id: booking.location_id,
                starts_at: startsAt,
                duration_minutes: duration,
                employee_id: booking.slot.employee_id,
                customer_name: booking.customer_name,
                version: booking.version,
              },
            )
          }
        >
          Confirm calendar change
        </Button>
        <Button variant="outline" disabled={action.locked} onClick={onClose}>
          Keep original time
        </Button>
      </div>
    </dialog>
  );
}
