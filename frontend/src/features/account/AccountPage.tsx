import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Layers, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, errorMessage, messageSchema, userSchema } from './api';
import { accountSchema, type AccountMode, type AccountValues } from './forms';

const labels: Record<AccountMode, [string, string, string]> = {
  login: ['Welcome back', 'Sign in to your scheduling workspace.', 'Sign in'],
  register: [
    'Start with your people',
    'Create your account. We’ll email you a verification link.',
    'Create account',
  ],
  forgot: [
    'Reset your password',
    'Enter your email and we’ll send a one-hour reset link.',
    'Send reset link',
  ],
  reset: [
    'Choose a new password',
    'Use at least 12 characters. Existing sessions will be signed out.',
    'Update password',
  ],
  verify: [
    'Verify your email',
    'Confirm your address to create or join a workspace.',
    'Verify email',
  ],
  invite: [
    'Your team is waiting',
    'Sign in with the invited email address, then accept your invitation.',
    'Accept invitation',
  ],
};

export function AccountPage({ mode }: { mode: AccountMode }) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [linkToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const form = useForm<AccountValues>({
    resolver: zodResolver(accountSchema(mode)),
    defaultValues: { email: '', name: '', password: '' },
  });
  useEffect(() => {
    if (window.location.hash)
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
  }, []);
  const tokenMode = ['verify', 'reset', 'invite'].includes(mode);

  const submit = form.handleSubmit(async (values) => {
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        const user = userSchema.parse(
          await api(
            '/auth/login',
            'POST',
            { email: values.email, password: values.password },
            false,
          ),
        );
        cache.clear();
        cache.setQueryData(['account'], user);
        navigate('/app');
        return;
      }
      if (mode === 'invite') {
        await api('/invitations/accept', 'POST', { token: linkToken });
        await cache.invalidateQueries({ queryKey: ['workspaces'] });
        navigate('/app');
        return;
      }
      const path = {
        register: 'register',
        forgot: 'request-password-reset',
        reset: 'reset-password',
        verify: 'verify-email',
      }[mode];
      const body =
        mode === 'register'
          ? values
          : mode === 'forgot'
            ? { email: values.email }
            : mode === 'reset'
              ? { token: linkToken, password: values.password }
              : { token: linkToken };
      const result = messageSchema.parse(
        await api(`/auth/${path}`, 'POST', body, false),
      );
      setMessage(result.message);
      setDone(true);
      await cache.invalidateQueries({ queryKey: ['account'] });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  });

  return (
    <div className="account-page">
      <aside className="account-story">
        <Link to="/" className="brand">
          <Layers />
          slotwise.
        </Link>
        <div>
          <p className="eyebrow">A BETTER WORKDAY STARTS HERE</p>
          <h1>
            Your people.
            <br />
            Your workspace.
            <br />
            Working together.
          </h1>
          <p>
            One secure home for your team and everything you’ll schedule next.
          </p>
        </div>
        <p className="account-assurance">
          <ShieldCheck size={18} />
          Your workspace, your permissions.
        </p>
      </aside>
      <main className="account-main">
        <Link to="/" className="account-home">
          SlotWise overview
        </Link>
        <section className="account-card">
          <p className="eyebrow">WELCOME TO SLOTWISE</p>
          <h2>{labels[mode][0]}</h2>
          <p>{labels[mode][1]}</p>
          {error && (
            <div className="form-error" role="alert">
              {error}
              {mode === 'invite' && (
                <p>
                  <Link to="/account/login">Sign in</Link>, then reopen the
                  invitation from your email.
                </p>
              )}
            </div>
          )}
          {message && (
            <div className="form-success" role="status">
              {message}
            </div>
          )}
          {tokenMode && !linkToken ? (
            <p role="alert" className="form-error">
              This link is missing its token. Open the full link from your
              email.
            </p>
          ) : (
            !done && (
              <form onSubmit={submit} noValidate>
                {mode === 'register' && (
                  <label>
                    Your name
                    <input
                      autoComplete="name"
                      {...form.register('name')}
                      aria-invalid={!!form.formState.errors.name}
                    />
                    <small role="alert">
                      {form.formState.errors.name?.message}
                    </small>
                  </label>
                )}
                {['login', 'register', 'forgot'].includes(mode) && (
                  <label>
                    Email address
                    <input
                      type="email"
                      autoComplete="email"
                      {...form.register('email')}
                      aria-invalid={!!form.formState.errors.email}
                    />
                    <small role="alert">
                      {form.formState.errors.email?.message}
                    </small>
                  </label>
                )}
                {['login', 'register', 'reset'].includes(mode) && (
                  <label>
                    Password
                    <input
                      type="password"
                      autoComplete={
                        mode === 'login' ? 'current-password' : 'new-password'
                      }
                      {...form.register('password')}
                      aria-invalid={!!form.formState.errors.password}
                    />
                    <small role="alert">
                      {form.formState.errors.password?.message}
                    </small>
                  </label>
                )}
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? 'Please wait…'
                    : labels[mode][2]}
                </Button>
              </form>
            )
          )}
          <div className="account-links">
            {mode === 'login' ? (
              <>
                <Link to="/account/forgot">Forgot password?</Link>
                <span>
                  New here?{' '}
                  <Link to="/account/register">Create an account</Link>
                </span>
              </>
            ) : (
              <>
                <Link to="/account/login">Back to sign in</Link>
                {done && <Link to="/app">Open workspace</Link>}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
