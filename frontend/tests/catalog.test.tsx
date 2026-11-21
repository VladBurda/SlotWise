import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import {
  CatalogEditor,
  CatalogPage,
} from '../src/features/catalog/CatalogPage';
import {
  newItem,
  validateDraft,
  type CatalogData,
} from '../src/features/catalog/contracts';
import { api } from '../src/features/account/api';

vi.mock('../src/features/account/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/account/api')>()),
  api: vi.fn(),
}));
const locationId = '11111111-1111-4111-8111-111111111111';
function editor(initial: CatalogData) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <CatalogEditor
        initial={initial}
        workspaceId={locationId}
        locations={[
          {
            id: locationId,
            version: 1,
            name: 'Workshop',
            address: '',
            active: true,
            timezone: 'Europe/Berlin',
            weekly: [],
            exceptions: [],
          },
        ]}
        items={[]}
        onSaved={onSaved}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onSaved;
}

test('variable duration must use complete steps', () => {
  const data = newItem('services', locationId);
  if (data.kind !== 'services') throw new Error('Wrong fixture');
  expect(() =>
    validateDraft({ ...data, name: 'Repair', maximum_duration_minutes: 42 }),
  ).toThrow('whole duration steps');
});

test('overlapping availability prevents save', async () => {
  vi.mocked(api).mockClear();
  const data = newItem('staff', locationId);
  if (data.kind !== 'staff') throw new Error('Wrong fixture');
  editor({
    ...data,
    name: 'Alex',
    availability: {
      ...data.availability,
      weekly: [
        { weekday: 0, start: 540, end: 720 },
        { weekday: 0, start: 600, end: 800 },
      ],
    },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Save staff' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'without overlaps',
  );
  expect(api).not.toHaveBeenCalled();
});

test('time entry accepts typing and saves minutes', async () => {
  const data = newItem('staff', locationId);
  if (data.kind !== 'staff') throw new Error('Wrong fixture');
  vi.mocked(api).mockImplementation(async (_path, _method, payload) => ({
    id: locationId,
    data: { ...(payload as CatalogData), version: 1 },
  }));
  const saved = editor({ ...data, name: 'Alex' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Add working hours' }),
  );
  const start = screen.getByLabelText('weekly start 1');
  await userEvent.clear(start);
  await userEvent.type(start, '08:30');
  expect(start).toHaveValue('08:30');
  await userEvent.click(screen.getByRole('button', { name: 'Save staff' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(vi.mocked(api).mock.lastCall?.[2]).toMatchObject({
    availability: { weekly: [{ weekday: 0, start: 510, end: 1020 }] },
  });
});

test('stale catalog edits keep draft text and explain reload', async () => {
  vi.mocked(api).mockRejectedValue(
    new Error('Settings changed. Reload before saving.'),
  );
  editor({ ...newItem('skills', locationId), name: 'Diagnostics' });
  await userEvent.clear(screen.getByLabelText('Name'));
  await userEvent.type(screen.getByLabelText('Name'), 'Advanced diagnostics');
  await userEvent.click(screen.getByRole('button', { name: 'Save skills' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Reload saved catalog',
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Advanced diagnostics');
});

test('resource selector resets incompatible fields', async () => {
  editor({ ...newItem('services', locationId), name: 'Consultation' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Add resource requirement' }),
  );
  await userEvent.selectOptions(
    screen.getByLabelText('Requirement selector'),
    'resource',
  );
  expect(
    screen.queryByLabelText('Required resource type'),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Required resource')).toBeRequired();
  expect(screen.getByLabelText('Asset quantity')).toHaveAttribute('max', '1');
});

test('switching sections after save leaves only the new editor', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const skill = {
    id: locationId,
    data: { ...newItem('skills', locationId), name: 'Diagnostics', version: 1 },
  };
  let saved = false;
  vi.mocked(api).mockImplementation(async (path, method) => {
    if (method === 'POST') {
      saved = true;
      return skill;
    }
    if (path.includes('/catalog/skills') && saved) return [skill];
    return [];
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CatalogPage
        workspace={{
          id: locationId,
          name: 'Workshop',
          slug: 'workshop',
          timezone: 'UTC',
          role: 'owner',
        }}
      />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Skills' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add skills' }));
  await userEvent.type(screen.getByLabelText('Name'), 'Diagnostics');
  await userEvent.click(screen.getByRole('button', { name: 'Save skills' }));
  expect(await screen.findByText('Diagnostics saved.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Staff' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add staff' }));
  expect(screen.getAllByLabelText('Name')).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: 'Save skills' }),
  ).not.toBeInTheDocument();
});
