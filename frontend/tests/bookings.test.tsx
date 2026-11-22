import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/features/account/api';
import { BookingEditor } from '../src/features/bookings/BookingEditor';
import { newItem } from '../src/features/catalog/contracts';
import { localDay, slotLabel } from '../src/features/bookings/contracts';

vi.mock('../src/features/account/api', async (original) => ({
  ...(await original<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const slot = {
  starts_at: '2026-11-30T08:00:00Z',
  ends_at: '2026-11-30T08:30:00Z',
  occupied_from: '2026-11-30T08:00:00Z',
  occupied_until: '2026-11-30T08:30:00Z',
  employee_id: id,
  employee_unit_id: id,
  resources: [],
};
const receipt = {
  id,
  service_id: id,
  location_id: id,
  customer_name: 'Jamie',
  status: 'confirmed',
  version: 1,
  slot,
  service_name: 'Consultation',
  price_minor: 2500,
  currency: 'EUR',
};
const available = {
  timezone: 'Europe/Berlin',
  computed_at: '2026-11-22T00:00:00Z',
  slots: [slot],
  truncated: false,
  warnings: [],
  reservation_aware: true,
};
function editor() {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue(available);
  const onSaved = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <BookingEditor
        workspaceId={id}
        items={[
          { id, data: { ...newItem('services', id), name: 'Consultation' } },
        ]}
        locations={[
          {
            id,
            version: 1,
            name: 'Office',
            address: '',
            timezone: 'Europe/Berlin',
            active: true,
            weekly: [],
            exceptions: [],
          },
        ]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}
async function choose() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Service'), id);
  await user.selectOptions(screen.getByLabelText('Location'), id);
  await user.click(
    screen.getByRole('button', { name: 'Find available times' }),
  );
  await user.click(await screen.findByRole('button', { name: /30 Nov 2026/ }));
  await user.type(screen.getByLabelText('Customer name'), 'Jamie');
  return user;
}
test('shows distinct offsets during the repeated local hour', () => {
  expect(slotLabel('2026-10-25T00:30:00Z', 'Europe/Berlin')).toContain('GMT+2');
  expect(slotLabel('2026-10-25T01:30:00Z', 'Europe/Berlin')).toContain('GMT+1');
  expect(localDay('2026-11-22T23:30:00Z', 'Europe/Berlin')).toBe('2026-11-23');
});
test('changing search fields clears the selected slot', async () => {
  editor();
  const user = await choose();
  await user.selectOptions(screen.getByLabelText('Service'), '');
  expect(
    screen.queryByRole('button', { name: 'Confirm booking' }),
  ).not.toBeInTheDocument();
});
test('lost response freezes the command and retries the same idempotency key', async () => {
  const saved = editor();
  const user = await choose();
  vi.mocked(api).mockRejectedValueOnce(new TypeError('Network interrupted'));
  await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
  await screen.findByRole('button', { name: 'Retry confirmation' });
  expect(screen.getByLabelText('Customer name')).toBeDisabled();
  const first = vi.mocked(api).mock.calls.find((call) => call[1] === 'POST');
  vi.mocked(api).mockResolvedValueOnce(receipt);
  await user.click(screen.getByRole('button', { name: 'Retry confirmation' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const posts = vi.mocked(api).mock.calls.filter((call) => call[1] === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(first);
  expect(first?.[4]).toMatch(/^[0-9a-f-]{36}$/);
});
test('a stale slot error clears confirmation and refreshes availability', async () => {
  editor();
  const user = await choose();
  vi.mocked(api).mockRejectedValueOnce(
    new ApiError(409, 'slot_unavailable', 'Slot taken.'),
  );
  await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
  await screen.findByText('Slot taken.');
  expect(
    screen.queryByRole('button', { name: 'Confirm booking' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close editor' })).toBeEnabled();
});
