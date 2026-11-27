import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Layers, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SystemStatus } from '@/features/system/SystemStatus';
import {
  api,
  ApiError,
  errorMessage,
  getUser,
  workspaceSchema,
  type User,
  type Workspace,
} from './api';
import { WorkspaceForm } from './WorkspaceForm';
import { TeamPanel } from './TeamPanel';
import { BookingPageSettings } from '@/features/portal/BookingPageSettings';
import { BusinessSettings } from '@/features/business/BusinessSettings';
const CatalogPage = lazy(() =>
  import('@/features/catalog/CatalogPage').then((module) => ({
    default: module.CatalogPage,
  })),
);
const BookingsPage = lazy(() =>
  import('@/features/bookings/BookingsPage').then((module) => ({
    default: module.BookingsPage,
  })),
);

const CalendarPage = lazy(() =>
  import('@/features/calendar/CalendarPage').then((module) => ({
    default: module.CalendarPage,
  })),
);

function VerifiedWorkspace({ user }: { user: User }) {
  const [search, setSearch] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [section, setSection] = useState('team');
  const cache = useQueryClient();
  const workspaces = useQuery({
    queryKey: ['workspaces', user.id],
    queryFn: async () => {
      const all: Workspace[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = z
          .array(workspaceSchema)
          .parse(await api(`/workspaces?offset=${offset}&limit=100`));
        all.push(...page);
        if (page.length < 100) return all;
      }
    },
  });
  const selected =
    workspaces.data?.find((item) => item.id === search.get('workspace')) ??
    workspaces.data?.[0];
  if (workspaces.isPending)
    return (
      <section className="panel skeleton" role="status">
        Loading your workspaces…
      </section>
    );
  if (workspaces.isError)
    return (
      <section className="panel">
        <p role="alert">{errorMessage(workspaces.error)}</p>
        <Button onClick={() => void workspaces.refetch()}>Try again</Button>
      </section>
    );
  if (creating || !selected)
    return (
      <WorkspaceForm
        onCancel={selected ? () => setCreating(false) : undefined}
        onCreated={(workspace) => {
          setSearch({ workspace: workspace.id });
          setCreating(false);
          void cache.invalidateQueries({ queryKey: ['workspaces'] });
        }}
      />
    );
  return (
    <>
      <div className="workspace-toolbar">
        <label>
          Current workspace
          <select
            value={selected.id}
            onChange={(event) => setSearch({ workspace: event.target.value })}
          >
            {workspaces.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus size={16} />
          New workspace
        </Button>
      </div>
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">YOUR TEAM’S HOME</p>
          <h1>{selected.name}</h1>
          <p>
            {selected.timezone} · {selected.slug}
          </p>
        </div>
        <span className="badge success">
          <ShieldCheck size={14} />
          {selected.role}
        </span>
      </div>
      {['owner', 'manager'].includes(selected.role) ? (
        <>
          <nav className="form-actions" aria-label="Workspace sections">
            {Object.entries({
              team: 'Team',
              settings: 'Business settings',
              catalog: 'Scheduling setup',
              bookings: 'Appointments',
              calendar: 'Calendar',
              portal: 'Booking page',
            }).map(([key, label]) => (
              <Button
                key={key}
                variant={section === key ? 'default' : 'outline'}
                onClick={() => setSection(key)}
              >
                {label}
              </Button>
            ))}
          </nav>
          {section === 'portal' ? (
            <BookingPageSettings key={selected.id} workspace={selected} />
          ) : section === 'calendar' ? (
            <Suspense fallback={<p role="status">Loading calendar…</p>}>
              <CalendarPage key={selected.id} workspace={selected} />
            </Suspense>
          ) : section === 'bookings' ? (
            <Suspense fallback={<p role="status">Loading appointments…</p>}>
              <BookingsPage key={selected.id} workspace={selected} />
            </Suspense>
          ) : section === 'catalog' ? (
            <Suspense fallback={<p role="status">Loading scheduling setup…</p>}>
              <CatalogPage key={selected.id} workspace={selected} />
            </Suspense>
          ) : section === 'settings' ? (
            <BusinessSettings key={selected.id} workspace={selected} />
          ) : (
            <TeamPanel key={selected.id} workspace={selected} />
          )}
        </>
      ) : (
        <section className="panel">
          <h2>You’re part of the team</h2>
          <p>
            Your {selected.role} membership is active. Workspace owners manage
            invitations and permissions.
          </p>
        </section>
      )}
      <div className="workspace-health">
        <SystemStatus />
      </div>
    </>
  );
}

export function WorkspacePage() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const account = useQuery({
    queryKey: ['account'],
    queryFn: getUser,
    retry: false,
    staleTime: 0,
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', 'POST'),
    onSuccess: () => {
      cache.clear();
      navigate('/account/login');
    },
  });
  const resend = useMutation({
    mutationFn: () =>
      api(
        '/auth/request-verification',
        'POST',
        { email: account.data?.email },
        false,
      ),
  });
  if (account.isPending)
    return (
      <main className="account-loading" role="status">
        Loading your account…
      </main>
    );
  if (account.error instanceof ApiError && account.error.status === 401)
    return <Navigate to="/account/login" replace />;
  if (account.isError || !account.data)
    return (
      <main className="account-loading">
        <p role="alert">{errorMessage(account.error)}</p>
        <Button onClick={() => void account.refetch()}>Try again</Button>
      </main>
    );
  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Layers size={22} />
          </span>
          slotwise.
        </Link>
        <div>
          <span>{account.data.name}</span>
          <Button
            variant="outline"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut size={15} />
            Sign out
          </Button>
        </div>
      </header>
      <main>
        {logout.isError && (
          <p role="alert" className="form-error">
            {errorMessage(logout.error)}
          </p>
        )}
        {account.data.verified ? (
          <VerifiedWorkspace user={account.data} />
        ) : (
          <section className="panel verification-panel">
            <p className="eyebrow">ONE LAST STEP</p>
            <h1>Check your inbox</h1>
            <p>
              Verify <strong>{account.data.email}</strong> to create or join a
              workspace.
            </p>
            <div className="form-actions">
              <Button
                disabled={resend.isPending}
                onClick={() => resend.mutate()}
              >
                Resend verification email
              </Button>
              <Button variant="outline" onClick={() => void account.refetch()}>
                I’ve verified my email
              </Button>
            </div>
            {resend.isSuccess && (
              <p role="status" className="form-success">
                If verification is needed, an email is on its way.
              </p>
            )}
            {resend.isError && <p role="alert">{errorMessage(resend.error)}</p>}
          </section>
        )}
      </main>
      <footer>SlotWise · Secure accounts and workspaces</footer>
    </div>
  );
}
