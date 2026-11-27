import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { api, ApiError } from '../src/features/account/api';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { PortalPage } from '../src/features/portal/PortalPage';
import { CustomerEditor } from '../src/features/portal/CustomerEditor';
import { BookingPageSettings } from '../src/features/portal/BookingPageSettings';

vi.mock('../src/features/account/api', async (original) => ({
  ...(await original<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
const id = '11111111-1111-4111-8111-111111111111';
const catalog = {
  name: 'Studio',
  slug: 'studio',
  cancellation: { allowed: true, notice_minutes: 1440 },
  locations: [{ id, name: 'Office', address: '', timezone: 'Europe/Berlin' }],
  staff: [],
  services: [
    {
      id,
      name: 'Consultation',
      description: '',
      duration_minutes: 30,
      maximum_duration_minutes: 60,
      duration_step_minutes: 5,
      price_minor: 2500,
      currency: 'EUR',
      location_ids: [id],
    },
  ],
};
const user = { id, name: 'Jamie', email: 'jamie@example.com', verified: true };
const receipt = {
  id,
  service_id: id,
  location_id: id,
  service_name: 'Consultation',
  customer_name: 'Jamie',
  starts_at: '2026-11-30T08:00:00Z',
  ends_at: '2026-11-30T08:30:00Z',
  status: 'confirmed',
  version: 1,
  price_minor: 2500,
  currency: 'EUR',
};
function editor(verified = true) {
  vi.mocked(api)
    .mockReset()
    .mockResolvedValue({
      timezone: 'Europe/Berlin',
      truncated: false,
      slots: [{ starts_at: receipt.starts_at, ends_at: receipt.ends_at }],
    });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CustomerEditor
        slug="studio"
        catalog={catalog}
        user={verified ? user : undefined}
        onSaved={onSaved}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}
async function choose() {
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Location' }),
    id,
  );
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Service' }),
    id,
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Find available times' }),
  );
  await userEvent.click(await screen.findByRole('button', { name: /30 Nov/ }));
}
test('visitors can browse times but must verify email before confirming', async () => {
  editor(false);
  await choose();
  expect(
    screen.getByRole('button', { name: 'Confirm my booking' }),
  ).toBeDisabled();
  expect(screen.getByText(/Verify your email below/)).toBeVisible();
  expect(api).toHaveBeenCalledWith(
    expect.stringContaining('/public/studio/availability?'),
    'GET',
    undefined,
    false,
  );
});
test('changing date clears the selected time and prevents a stale confirmation', async () => {
  editor();
  await choose();
  await userEvent.clear(screen.getByLabelText('Date at location'));
  expect(
    screen.queryByRole('button', { name: 'Confirm my booking' }),
  ).not.toBeInTheDocument();
});
test('an uncertain customer write is frozen and retried with the same key', async () => {
  const onSaved = editor();
  await choose();
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('Lost response'))
    .mockResolvedValueOnce(receipt);
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm my booking' }),
  );
  await screen.findByRole('button', { name: 'Retry booking confirmation' });
  expect(
    screen.getByRole('button', { name: 'View my appointments' }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry booking confirmation' }),
  );
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const writes = vi.mocked(api).mock.calls.filter((call) => call[1] === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});
test('managers can inspect but cannot publish the booking page', async () => {
  vi.mocked(api).mockReset().mockResolvedValue({ enabled: false, version: 0 });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingPageSettings
        workspace={{
          id,
          name: 'Studio',
          slug: 'studio',
          timezone: 'UTC',
          role: 'manager',
        }}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole('button', { name: 'Publish booking page' }),
  ).toBeDisabled();
});

test('an email link opened on the same portal page still shows verification', async () => {
  let signedIn = false;
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === '/public/studio') return catalog;
      if (path === '/auth/booking-login') {
        signedIn = true;
        return user;
      }
      if (path === '/auth/me' && signedIn) return user;
      throw new ApiError(401, 'unauthenticated', 'Please sign in.');
    });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={['/book/studio']}>
        <Link to={`/book/studio#token=${'a'.repeat(43)}`}>Open email link</Link>
        <Routes>
          <Route path="/book/:slug" element={<PortalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole('button', { name: 'Verify email and continue' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Open email link' }));
  expect(
    await screen.findByRole('button', { name: 'Verify email and continue' }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole('button', { name: 'Verify email and continue' }),
  );
  await screen.findByText(`Email verified. Booking as ${user.email}.`);
  await userEvent.click(screen.getByRole('link', { name: 'Open email link' }));
  expect(
    await screen.findByRole('button', { name: 'Verify email and continue' }),
  ).toBeEnabled();
});
