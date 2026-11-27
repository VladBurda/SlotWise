import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, getUser, userSchema } from '@/features/account/api';
import { slotLabel } from '@/features/bookings/contracts';
import { useRequestAction } from '@/features/bookings/useBookingAction';
import { CustomerEditor } from './CustomerEditor';
import {
  customerBooking,
  portalCatalog,
  type CustomerBooking,
} from './contracts';

function CancelBooking({
  slug,
  booking,
  onSaved,
  onClose,
}: {
  slug: string;
  booking: CustomerBooking;
  onSaved: (booking: CustomerBooking) => void;
  onClose: () => void;
}) {
  const action = useRequestAction(onSaved, () => {}, customerBooking.parse);
  return (
    <section
      className="panel settings-form"
      aria-label="Cancel your appointment"
    >
      <h2>Cancel this appointment?</h2>
      <p>
        {booking.service_name} · {slotLabel(booking.starts_at, 'UTC')}
      </p>
      <p>The business cancellation policy is checked when you confirm.</p>
      <Button
        disabled={action.locked || action.isError}
        onClick={() =>
          action.submit(`/public/${slug}/bookings/${booking.id}/cancel`, {
            version: booking.version,
          })
        }
      >
        Confirm cancellation
      </Button>
      {action.isError && <p role="alert">{errorMessage(action.error)}</p>}
      {action.locked && !action.isPending && (
        <Button onClick={action.retryCommand}>Retry cancellation</Button>
      )}
      <Button variant="outline" disabled={action.locked} onClick={onClose}>
        Keep appointment
      </Button>
    </section>
  );
}

export function PortalPage() {
  const { slug = '' } = useParams();
  return <Portal key={slug} slug={slug} />;
}

function Portal({ slug }: { slug: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  useEffect(() => {
    if (!location.hash) return;
    setToken(new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
    void navigate(location.pathname + location.search, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);
  const [mode, setMode] = useState<'new' | 'history' | 'edit' | 'cancel'>(
    'new',
  );
  const [selected, setSelected] = useState<CustomerBooking | undefined>();
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [offset, setOffset] = useState(0);
  const catalog = useQuery({
    queryKey: ['public-catalog', slug],
    queryFn: async () =>
      portalCatalog.parse(
        await api(`/public/${slug}`, 'GET', undefined, false),
      ),
    retry: false,
  });
  const user = useQuery({
    queryKey: ['portal-user'],
    queryFn: getUser,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['customer-bookings', slug, user.data?.id, offset],
    enabled:
      Boolean(user.data?.verified) && (mode === 'history' || catalog.isError),
    retry: false,
    queryFn: async () =>
      z
        .array(customerBooking)
        .parse(
          await api(`/public/${slug}/my-bookings?offset=${offset}&limit=50`),
        ),
  });
  const access = useMutation({
    mutationFn: () =>
      api(
        '/auth/booking-access',
        'POST',
        { name: name.trim(), email, slug },
        false,
      ),
    onSuccess: () =>
      setMessage(
        'Check your email for a one-use booking access link. It expires in 15 minutes.',
      ),
  });
  const verify = useMutation({
    mutationFn: async () =>
      userSchema.parse(
        await api('/auth/booking-login', 'POST', { token }, false),
      ),
    onSuccess: (value) => {
      cache.clear();
      cache.setQueryData(['portal-user'], value);
      setToken('');
      setMessage(`Email verified. Booking as ${value.email}.`);
    },
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', 'POST'),
    onSuccess: () => {
      cache.clear();
      setSelected(undefined);
      setMode('new');
      setMessage('Signed out.');
    },
  });
  const saved = (booking: CustomerBooking) => {
    setMessage(
      booking.status === 'cancelled'
        ? 'Your appointment has been cancelled.'
        : `Your appointment is confirmed. Reference: ${booking.id}`,
    );
    setSelected(undefined);
    setOffset(0);
    setMode('history');
    void cache.invalidateQueries({ queryKey: ['customer-bookings', slug] });
    void cache.invalidateQueries({ queryKey: ['public-availability', slug] });
  };
  const close = () => {
    setMode('history');
    setSelected(undefined);
    void history.refetch();
  };
  return (
    <main className="public-portal">
      <header className="workspace-toolbar">
        <Link to="/" className="brand">
          SlotWise
        </Link>
        {user.data && (
          <div>
            <span>{user.data.email}</span>{' '}
            <Button
              variant="outline"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Sign out
            </Button>
          </div>
        )}
      </header>
      <section className="workspace-intro">
        <div>
          <p className="eyebrow">BOOK YOUR NEXT VISIT</p>
          <h1>{catalog.data?.name ?? 'Your appointments'}</h1>
          <p>Choose a service, find a time, and confirm your visit.</p>
        </div>
      </section>
      {message && (
        <p className="panel" role="status">
          {message}
        </p>
      )}
      {catalog.isPending && <p role="status">Loading booking page…</p>}
      {catalog.isError && (
        <p role="alert">
          {errorMessage(catalog.error)} Existing customers can still access
          their appointment history below.
        </p>
      )}
      {token && (
        <section className="panel settings-form">
          <h2>Verify your email</h2>
          <p>Use your one-use link to sign in and manage your appointments.</p>
          <Button disabled={verify.isPending} onClick={() => verify.mutate()}>
            Verify email and continue
          </Button>
          {verify.isError && (
            <p role="alert">
              {errorMessage(verify.error)} Request a new email link below.
            </p>
          )}
        </section>
      )}
      {!token && catalog.data && (mode === 'new' || mode === 'edit') && (
        <CustomerEditor
          key={`${mode}:${selected?.id ?? ''}:${user.data?.id ?? 'guest'}`}
          slug={slug}
          catalog={catalog.data}
          user={user.data}
          initial={mode === 'edit' ? selected : undefined}
          onSaved={saved}
          onClose={close}
        />
      )}
      {(!user.data?.verified || verify.isError) && (
        <section className="panel settings-form">
          <h2>Verify your email to book or manage appointments</h2>
          <p>
            No password needed. We create or sign you into a customer account so
            only you can access your bookings.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              access.mutate();
            }}
          >
            <label>
              Your name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <Button disabled={access.isPending || !name.trim()}>
              Email me a secure link
            </Button>
          </form>
          {access.isError && <p role="alert">{errorMessage(access.error)}</p>}
        </section>
      )}
      {user.data?.verified &&
        !token &&
        (mode === 'history' || (catalog.isError && mode === 'new')) && (
          <section
            className="panel settings-form"
            aria-label="Your appointment history"
          >
            <h2>Your appointments</h2>
            {catalog.data && (
              <Button
                onClick={() => {
                  setMode('new');
                  setSelected(undefined);
                }}
              >
                Book another appointment
              </Button>
            )}
            {history.isFetching && (
              <p role="status">Loading your appointments…</p>
            )}
            {history.isError && (
              <p role="alert">{errorMessage(history.error)}</p>
            )}
            {history.data?.length === 0 && <p>No appointments on this page.</p>}
            {history.data?.map((booking) => (
              <article key={booking.id} className="panel">
                <h3>{booking.service_name}</h3>
                <p>
                  {slotLabel(
                    booking.starts_at,
                    catalog.data?.locations.find(
                      (item) => item.id === booking.location_id,
                    )?.timezone ?? 'UTC',
                  )}{' '}
                  · {booking.status}
                </p>
                <p>
                  {booking.customer_name} · Reference: {booking.id}
                </p>
                {booking.status === 'confirmed' && (
                  <div className="form-actions">
                    {catalog.data && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSelected(booking);
                          setMode('edit');
                        }}
                      >
                        Change appointment
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(booking);
                        setMode('cancel');
                      }}
                    >
                      Cancel appointment
                    </Button>
                  </div>
                )}
              </article>
            ))}
            <div className="form-actions">
              <Button
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Previous appointments
              </Button>
              <Button
                variant="outline"
                disabled={history.data?.length !== 50}
                onClick={() => setOffset(offset + 50)}
              >
                More appointments
              </Button>
            </div>
          </section>
        )}
      {mode === 'cancel' && selected && (
        <CancelBooking
          slug={slug}
          booking={selected}
          onSaved={saved}
          onClose={close}
        />
      )}
      {logout.isError && <p role="alert">{errorMessage(logout.error)}</p>}
      <footer>
        <Link to="/app">Business workspace</Link>
      </footer>
    </main>
  );
}
