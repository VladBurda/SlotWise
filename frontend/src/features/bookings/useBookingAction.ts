import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/features/account/api';
import { bookingSchema, type Booking } from './contracts';

type Command = { path: string; body: unknown; key: string };
export function useBookingAction(
  onSaved: (booking: Booking) => void,
  onRejected: () => void,
) {
  return useRequestAction(onSaved, onRejected, bookingSchema.parse);
}

export function useRequestAction<T>(
  onSaved: (value: T) => void,
  onRejected: () => void,
  parse: (value: unknown) => T,
) {
  const [command, setCommand] = useState<Command | null>(null);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (value: Command) =>
      parse(await api(value.path, 'POST', value.body, true, value.key)),
    onSuccess: (booking) => {
      setCommand(null);
      onSaved(booking);
    },
    onError: (error) => {
      // A lost response may have committed. Freeze the command and reuse its key.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        setCommand(null);
        onRejected();
      }
    },
  });
  return {
    ...mutation,
    locked: command !== null,
    retryCommand: () => {
      if (command) mutation.mutate(command);
    },
    submit: (path: string, body: unknown) => {
      if (command) return;
      const next = { path, body, key: crypto.randomUUID() };
      setCommand(next);
      mutation.mutate(next);
    },
  };
}
