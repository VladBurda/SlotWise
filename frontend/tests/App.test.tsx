import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import App from '../src/app/App';

function renderApp() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <App />
    </QueryClientProvider>,
  );
}
test('renders real dependency status without booking metrics', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ready', database: true, redis: true }),
        ),
      ),
  );
  renderApp();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'A little more organized.',
  );
  expect(await screen.findAllByText('Connected')).toHaveLength(3);
  expect(screen.getByText('Phase 1 · No booking data yet')).toBeInTheDocument();
});
test('shows a partial dependency outage and supports retry', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'unavailable', database: false, redis: true }),
        { status: 503 },
      ),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'ready', database: true, redis: true }),
      ),
    );
  vi.stubGlobal('fetch', fetch);
  renderApp();
  expect(await screen.findByText('Unavailable')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findAllByText('Connected')).toHaveLength(3);
});
test('opens and closes the responsive navigation', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: 'ready', database: true, redis: true }),
        ),
      ),
  );
  renderApp();
  const toggle = screen.getByRole('button', { name: 'Open navigation' });
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await userEvent.click(
    screen.getByRole('button', { name: 'Close navigation' }),
  );
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
