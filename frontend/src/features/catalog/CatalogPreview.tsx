import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { api, errorMessage } from '@/features/account/api';
import { Button } from '@/components/ui/button';
import type { CatalogItem } from './contracts';
import type { Location } from '@/features/business/contracts';

const previewSchema = z.array(
  z.object({
    day: z.string(),
    intervals: z.array(z.tuple([z.string(), z.string()])),
    issue: z.string().nullable(),
  }),
);
const candidate = z.object({ id: z.string(), name: z.string() });
const matchesSchema = z.object({
  staff: z.array(candidate),
  requirements: z.array(
    z.object({
      quantity: z.number(),
      units_per_resource: z.number(),
      candidates: z.array(candidate),
      enough_candidates: z.boolean(),
    }),
  ),
  notice: z.string(),
});

export function CatalogPreview({
  item,
  workspaceId,
  locations,
}: {
  item: CatalogItem;
  workspaceId: string;
  locations: Location[];
}) {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [locationId, setLocationId] = useState(
    item.data.kind === 'services'
      ? (item.data.location_ids[0] ?? '')
      : 'location_id' in item.data
        ? item.data.location_id
        : '',
  );
  const base = `/workspaces/${workspaceId}/catalog/${item.data.kind}/${item.id}`;
  const preview = useMutation({
    mutationFn: async () =>
      previewSchema.parse(await api(`${base}/preview?start=${day}`)),
  });
  const matches = useMutation({
    mutationFn: async () =>
      matchesSchema.parse(
        await api(`${base}/matches?location_id=${locationId}&on_date=${day}`),
      ),
  });
  const zone = locations.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const time = (value: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  if (item.data.kind === 'skills' || item.data.kind === 'pools') return null;
  return (
    <section className="panel settings-form">
      <h3>Check saved configuration</h3>
      <p>
        Save changes before checking. These results do not reserve an
        appointment.
      </p>
      <label>
        Check date
        <input
          type="date"
          required
          min="1900-01-01"
          max="2100-12-01"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            preview.reset();
            matches.reset();
          }}
        />
      </label>
      {item.data.kind === 'services' ? (
        <>
          <label>
            Check location
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                matches.reset();
              }}
            >
              {locations
                .filter(
                  (l) =>
                    item.data.kind === 'services' &&
                    item.data.location_ids.includes(l.id ?? ''),
                )
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            disabled={!day || !locationId || matches.isPending}
            onClick={() => matches.mutate()}
          >
            Check staff and resources
          </Button>
          {matches.isError && <p role="alert">{errorMessage(matches.error)}</p>}
          {matches.data && (
            <div role="status">
              <h4>Qualified staff</h4>
              <p>
                {matches.data.staff.map((s) => s.name).join(', ') ||
                  'No eligible staff. Check qualifications, expiry dates and location.'}
              </p>
              {matches.data.requirements.map((r, i) => (
                <div key={i}>
                  <h4>
                    Requirement {i + 1}: {r.quantity} assets ×{' '}
                    {r.units_per_resource} units
                  </h4>
                  <p>
                    {r.candidates.map((c) => c.name).join(', ') ||
                      'No matching resources'}
                  </p>
                  {!r.enough_candidates && (
                    <p className="form-error">
                      Not enough matching assets for this requirement.
                    </p>
                  )}
                </div>
              ))}
              <p>{matches.data.notice}</p>
            </div>
          )}
        </>
      ) : (
        <>
          <Button
            disabled={!day || preview.isPending}
            onClick={() => preview.mutate()}
          >
            Preview seven days
          </Button>
          {preview.isError && <p role="alert">{errorMessage(preview.error)}</p>}
          {preview.data && (
            <div role="status">
              <p>Location time zone: {zone}</p>
              {preview.data.map((row) => (
                <div className="catalog-subpanel" key={row.day}>
                  <strong>{row.day}</strong>
                  {row.issue ? (
                    <p>{row.issue}</p>
                  ) : row.intervals.length ? (
                    row.intervals.map(([a, b]) => (
                      <p key={a}>
                        {time(a)} – {time(b)}
                      </p>
                    ))
                  ) : (
                    <p>Unavailable</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
