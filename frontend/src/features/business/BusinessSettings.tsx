import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Workspace } from '@/features/account/api';
import {
  locationSchema,
  profileSchema,
  type Location,
  type Profile,
} from './contracts';
import { LocationEditor } from './LocationEditor';

const policyFields = [
  ['minimum_notice_minutes', 'Minimum booking notice (minutes)', 0, 525600],
  ['booking_horizon_days', 'Maximum booking horizon (days)', 1, 365],
  [
    'default_duration_minutes',
    'Default appointment duration (minutes)',
    5,
    1440,
  ],
  ['slot_interval_minutes', 'Slot interval (minutes)', 1, 120],
  ['buffer_before_minutes', 'Preparation buffer (minutes)', 0, 1440],
  ['buffer_after_minutes', 'Cleanup buffer (minutes)', 0, 1440],
  [
    'cancellation_notice_minutes',
    'Cancellation cutoff (minutes before appointment)',
    0,
    525600,
  ],
] as const;

export function ProfileEditor({
  initial,
  workspace,
  onSaved,
}: {
  initial: Profile;
  workspace: Workspace;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const parsed = profileSchema.safeParse(form);
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((i) => i.message).join(' '));
      return profileSchema.parse(
        await api(`/workspaces/${workspace.id}/settings`, 'PATCH', parsed.data),
      );
    },
    onSuccess: (data) => {
      setForm(data);
      onSaved();
    },
  });
  const readOnly = workspace.role !== 'owner';
  return (
    <form
      className="panel settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError('');
        save.mutate();
      }}
    >
      <h2>Business profile &amp; policies</h2>
      <p>
        Owners configure these settings. Managers can review them. Existing
        locations keep their own time zone when the business default changes.
      </p>
      <fieldset disabled={readOnly || save.isPending}>
        <div className="settings-grid">
          <label>
            Business name
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Default time zone
            <input
              required
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
          </label>
          <label>
            Contact email
            <input
              type="email"
              maxLength={254}
              value={form.contact_email ?? ''}
              onChange={(e) =>
                setForm({ ...form, contact_email: e.target.value || null })
              }
            />
          </label>
          <label>
            Phone
            <input
              maxLength={50}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
        </div>
        <label>
          Business description
          <textarea
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <h3>Booking defaults</h3>
        <p>
          These defaults will apply when appointment booking becomes available.
          Durations and buffers are elapsed minutes; the horizon is measured in
          24-hour days.
        </p>
        <div className="settings-grid">
          {policyFields.map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                required
                min={min}
                max={max}
                step={1}
                value={form.policies[key]}
                onChange={(e) =>
                  setForm({
                    ...form,
                    policies: {
                      ...form.policies,
                      [key]: e.target.valueAsNumber,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.policies.cancellation_allowed}
            onChange={(e) =>
              setForm({
                ...form,
                policies: {
                  ...form.policies,
                  cancellation_allowed: e.target.checked,
                },
              })
            }
          />
          Allow customer cancellation
        </label>
        {!readOnly && (
          <Button disabled={save.isPending}>Save business settings</Button>
        )}
      </fieldset>
      {(error || save.isError) && (
        <p role="alert">{error || errorMessage(save.error)}</p>
      )}
      {save.isSuccess && <p role="status">Business settings saved.</p>}
    </form>
  );
}

export function BusinessSettings({ workspace }: { workspace: Workspace }) {
  const cache = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Location | null>(null);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState('');
  const base = `/workspaces/${workspace.id}`;
  const profile = useQuery({
    queryKey: ['business', workspace.id],
    refetchOnWindowFocus: false,
    queryFn: async () => profileSchema.parse(await api(base + '/settings')),
  });
  const locations = useQuery({
    queryKey: ['locations', workspace.id, offset],
    queryFn: async () =>
      z
        .array(locationSchema)
        .parse(await api(base + `/locations?offset=${offset}&limit=20`)),
  });
  const reload = () => {
    if (
      !window.confirm(
        'Reload saved settings? Unsaved changes will be discarded.',
      )
    )
      return;
    setSelected(null);
    setCreating(false);
    void profile.refetch();
    void locations.refetch();
  };
  if (profile.isPending || locations.isPending)
    return <p role="status">Loading business settings…</p>;
  if (profile.isError || locations.isError)
    return (
      <section className="panel">
        <p role="alert">{errorMessage(profile.error ?? locations.error)}</p>
        <Button
          onClick={() => {
            void profile.refetch();
            void locations.refetch();
          }}
        >
          Retry settings
        </Button>
      </section>
    );
  return (
    <div className="business-settings">
      <div className="settings-heading">
        <h2>Business settings</h2>
        <Button variant="outline" onClick={reload}>
          Reload saved settings
        </Button>
      </div>
      <ProfileEditor
        key={`${workspace.id}-${profile.data.version}-${profile.dataUpdatedAt}`}
        initial={profile.data}
        workspace={workspace}
        onSaved={() => {
          void cache.invalidateQueries({ queryKey: ['workspaces'] });
        }}
      />
      <section className="panel">
        <div className="settings-heading">
          <h2>Locations &amp; operating hours</h2>
          {workspace.role === 'owner' && (
            <Button
              onClick={() => {
                setSelected(null);
                setCreating(true);
                setSaved('');
              }}
            >
              Add location
            </Button>
          )}
        </div>
        <p>
          Each location uses local civil time. Unconfigured days are closed.
          Deactivate a location to retain its rules while closing all dates.
        </p>
        {!locations.data.length && <p>No locations yet.</p>}
        <ul className="location-list">
          {locations.data.map((location) => (
            <li key={location.id}>
              <div>
                <strong>{location.name}</strong>
                <p>
                  {location.timezone} ·{' '}
                  {location.active ? 'Active' : 'Inactive'}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setCreating(false);
                  setSelected(location);
                  setSaved('');
                }}
              >
                Open {location.name}
              </Button>
            </li>
          ))}
        </ul>
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(offset - 20)}
          >
            Previous locations
          </Button>
          <Button
            variant="outline"
            disabled={locations.data.length < 20}
            onClick={() => setOffset(offset + 20)}
          >
            Next locations
          </Button>
        </div>
        {saved && <p role="status">{saved}</p>}
      </section>
      {(creating || selected) && (
        <LocationEditor
          key={selected?.id ?? 'new'}
          workspace={workspace}
          initial={
            selected ?? {
              version: 0,
              name: '',
              address: '',
              timezone: profile.data.timezone,
              active: true,
              weekly: [],
              exceptions: [],
            }
          }
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSaved={(data) => {
            setSelected(data);
            setCreating(false);
            setSaved('Location saved.');
            void cache.invalidateQueries({
              queryKey: ['locations', workspace.id],
            });
          }}
        />
      )}
    </div>
  );
}
