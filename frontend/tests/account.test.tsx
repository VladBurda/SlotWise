import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AccountPage } from '../src/features/account/AccountPage';
import { WorkspaceForm } from '../src/features/account/WorkspaceForm';
import {
  accountSchema,
  workspaceFormSchema,
  type AccountMode,
} from '../src/features/account/forms';

function account(mode: AccountMode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<AccountPage mode={mode} />} />
          <Route path="/app" element={<h1>Authenticated workspace</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test('registration validates before making any request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  account('register');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    await screen.findByText('Enter a valid email address.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Use 12–128 characters.')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
test('login errors remain on the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/csrf')
              ? { csrf_token: 'a'.repeat(43) }
              : {
                  error: {
                    code: 'invalid_credentials',
                    message: 'Email or password is incorrect.',
                  },
                },
          ),
          { status: url.endsWith('/csrf') ? 200 : 401 },
        ),
      ),
    ),
  );
  account('login');
  await userEvent.type(
    screen.getByLabelText('Email address'),
    'user@example.com',
  );
  await userEvent.type(screen.getByLabelText('Password'), 'wrongpassword');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(
    await screen.findByText('Email or password is incorrect.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('Authenticated workspace')).not.toBeInTheDocument();
});
test('missing email-link token cannot be submitted', () => {
  account('reset');
  expect(screen.getByRole('alert')).toHaveTextContent('missing its token');
  expect(
    screen.queryByRole('button', { name: 'Update password' }),
  ).not.toBeInTheDocument();
});
test('workspace form reports validation errors', async () => {
  const created = vi.fn();
  render(<WorkspaceForm onCreated={created} />);
  await userEvent.click(
    screen.getByRole('button', { name: 'Create workspace' }),
  );
  expect(
    await screen.findByText('Enter a workspace name.'),
  ).toBeInTheDocument();
  expect(created).not.toHaveBeenCalled();
});
test('schemas reject short passwords and malformed workspace addresses', () => {
  expect(
    accountSchema('register').safeParse({
      name: 'Test',
      email: 'test@example.com',
      password: 'short',
    }).success,
  ).toBe(false);
  expect(
    workspaceFormSchema.safeParse({
      name: 'Test',
      slug: 'Bad Slug',
      timezone: 'UTC',
    }).success,
  ).toBe(false);
});
