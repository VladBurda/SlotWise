import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/features/account/api';
import {
  CalendarChange,
  proposeChange,
} from '../src/features/calendar/CalendarChange';
import { TimelineCard } from '../src/features/calendar/TimelineCard';
import type { Booking } from '../src/features/bookings/contracts';

vi.mock('../src/features/account/api', async (original) => ({
  ...(await original<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const booking: Booking = {
  id,
  service_id: id,
  location_id: id,
  customer_name: 'Jamie',
  status: 'confirmed',
  version: 3,
  service_name: 'Consultation',
  price_minor: 2500,
  currency: 'EUR',
  slot: {
    starts_at: '2026-10-25T00:45:00Z',
    ends_at: '2026-10-25T01:15:00Z',
    occupied_from: '2026-10-25T00:45:00Z',
    occupied_until: '2026-10-25T01:15:00Z',
    employee_id: id,
    employee_unit_id: id,
    resources: [],
  },
};
function editor() {
  vi.mocked(api).mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  const cache = new QueryClient();
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={cache}>
      <CalendarChange
        proposal={proposeChange(booking, 15, false)}
        workspaceId={id}
        timezone="Europe/Berlin"
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onClose, invalidate };
}
test('moves elapsed time across a DST fold and resizes without moving the start', () => {
  expect(proposeChange(booking, 15, false)).toMatchObject({
    startsAt: '2026-10-25T01:00:00.000Z',
    duration: 30,
  });
  expect(proposeChange(booking, 5, true)).toMatchObject({
    startsAt: '2026-10-25T00:45:00.000Z',
    duration: 35,
  });
});
test('sends a versioned change only after confirmation and invalidates related data', async () => {
  const { onClose, invalidate } = editor();
  expect(api).not.toHaveBeenCalled();
  vi.mocked(api).mockResolvedValue({ ...booking, version: 4 });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm calendar change' }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(
    expect.stringContaining('/reschedule'),
    'POST',
    expect.objectContaining({
      version: 3,
      employee_id: id,
      duration_minutes: 30,
      starts_at: '2026-10-25T01:00:00.000Z',
    }),
    true,
    expect.any(String),
  );
  expect(invalidate).toHaveBeenCalledTimes(3);
});
test('a conflict keeps the original booking and refreshes stale data', async () => {
  const { onClose, invalidate } = editor();
  vi.mocked(api).mockRejectedValue(
    new ApiError(409, 'conflict', 'Time is no longer available'),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm calendar change' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Time is no longer available',
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledTimes(3);
  expect(
    screen.getByRole('button', { name: 'Confirm calendar change' }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Keep original time' }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
test('an uncertain result locks dismissal and retries the exact command and key', async () => {
  const { onClose } = editor();
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('Lost response'))
    .mockResolvedValueOnce({ ...booking, version: 4 });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm calendar change' }),
  );
  await screen.findByRole('button', { name: 'Retry calendar change' });
  expect(
    screen.getByRole('button', { name: 'Keep original time' }),
  ).toBeDisabled();
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { cancelable: true }),
  );
  expect(onClose).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry calendar change' }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(vi.mocked(api).mock.calls[1]).toEqual(vi.mocked(api).mock.calls[0]);
});
test('keyboard movement and resizing produce proposals; cancelled bookings stay read-only', () => {
  const onPropose = vi.fn();
  const { rerender } = render(
    <TimelineCard
      booking={booking}
      elapsed={90000000}
      step={5}
      onPropose={onPropose}
    >
      Jamie
    </TimelineCard>,
  );
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowRight' });
  expect(onPropose).toHaveBeenLastCalledWith(proposeChange(booking, 15, false));
  fireEvent.keyDown(screen.getByRole('button'), {
    key: 'ArrowLeft',
    shiftKey: true,
  });
  expect(onPropose).toHaveBeenLastCalledWith(proposeChange(booking, -5, true));
  rerender(
    <TimelineCard
      booking={{ ...booking, status: 'cancelled' }}
      elapsed={90000000}
      step={5}
      onPropose={onPropose}
    >
      Jamie
    </TimelineCard>,
  );
  fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowRight' });
  expect(onPropose).toHaveBeenCalledTimes(2);
});
