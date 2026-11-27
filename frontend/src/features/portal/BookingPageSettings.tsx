import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Workspace } from '@/features/account/api';
const schema = z.object({ enabled: z.boolean(), version: z.number() });
export function BookingPageSettings({ workspace }: { workspace: Workspace }) {
  const cache = useQueryClient();
  const path = `/workspaces/${workspace.id}/booking-page`;
  const settings = useQuery({
    queryKey: ['booking-page', workspace.id],
    queryFn: async () => schema.parse(await api(path)),
  });
  const save = useMutation({
    mutationFn: async () =>
      schema.parse(
        await api(path, 'PATCH', {
          enabled: !settings.data!.enabled,
          version: settings.data!.version,
        }),
      ),
    onSuccess: () =>
      void cache.invalidateQueries({
        queryKey: ['booking-page', workspace.id],
      }),
  });
  return (
    <section className="panel settings-form">
      <h2>Public booking page</h2>
      <p>
        Publish your locations, services, prices and staff names so customers
        can book online. Private schedules and resource allocations stay
        internal.
      </p>
      {settings.isPending && (
        <p role="status">Loading booking page settings…</p>
      )}
      {settings.data && (
        <>
          <p>
            Status:{' '}
            {settings.data.enabled ? 'Published' : 'Not accepting new bookings'}
          </p>
          <p>
            Share this address:{' '}
            <a href={`/book/${workspace.slug}`}>
              {window.location.origin}/book/{workspace.slug}
            </a>
          </p>
          <p>
            Disabling the page stops new bookings. Existing customers can still
            view their history and cancel permitted appointments.
          </p>
          <Button
            disabled={save.isPending || workspace.role !== 'owner'}
            onClick={() => save.mutate()}
          >
            {settings.data.enabled
              ? 'Disable booking page'
              : 'Publish booking page'}
          </Button>
        </>
      )}
      {(settings.isError || save.isError) && (
        <p role="alert">{errorMessage(settings.error ?? save.error)}</p>
      )}
      <Button variant="outline" onClick={() => void settings.refetch()}>
        Reload page settings
      </Button>
    </section>
  );
}
