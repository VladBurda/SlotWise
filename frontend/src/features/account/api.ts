import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  verified: z.boolean(),
});
export type User = z.infer<typeof userSchema>;
export const roleSchema = z.enum(['owner', 'manager', 'employee', 'customer']);
export type Role = z.infer<typeof roleSchema>;
export const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  role: roleSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const memberSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
});
export type Member = z.infer<typeof memberSchema>;
export const invitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: roleSchema,
  expires_at: z.string(),
  accepted: z.boolean(),
  revoked: z.boolean(),
});
export const messageSchema = z.object({ message: z.string() });

async function csrf(): Promise<string> {
  const match = document.cookie
    .split('; ')
    .find(
      (item) =>
        item.startsWith('sw_csrf=') || item.startsWith('__Host-sw_csrf='),
    );
  if (match) return decodeURIComponent(match.slice(match.indexOf('=') + 1));
  const response = await fetch('/api/v1/auth/csrf', {
    credentials: 'same-origin',
  });
  if (!response.ok)
    throw new Error('Unable to initialize a secure session. Try again.');
  return z.object({ csrf_token: z.string() }).parse(await response.json())
    .csrf_token;
}

let refreshing: Promise<boolean> | undefined;
async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    const refresh = async () => {
      // Another tab may have refreshed while waiting for the browser-wide lock.
      if ((await fetch('/api/v1/auth/me')).ok) return true;
      return (
        await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': await csrf() },
        })
      ).ok;
    };
    refreshing = (
      navigator.locks
        ? navigator.locks.request('slotwise-session-refresh', refresh)
        : refresh()
    ).finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
}

export async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  authenticated = true,
): Promise<unknown> {
  const send = async () =>
    fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-CSRF-Token': await csrf() } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  let response = await send();
  if (response.status === 401 && authenticated && (await refreshSession()))
    response = await send();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ApiError(
      response.status,
      'invalid_response',
      'The service did not respond correctly. Please try again.',
    );
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .safeParse(payload);
    throw new ApiError(
      response.status,
      error.success ? error.data.error.code : 'request_failed',
      error.success
        ? error.data.error.message
        : 'Request failed. Please try again.',
    );
  }
  return payload;
}

export async function getUser(): Promise<User> {
  return userSchema.parse(await api('/auth/me'));
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}
