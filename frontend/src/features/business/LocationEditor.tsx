import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api, errorMessage, type Workspace } from '@/features/account/api';
import {
  formatMinute,
  parseMinute,
  locationSchema,
  previewSchema,
  weekdays,
  type Interval,
  type Location,
} from './contracts';

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(formatMinute(value));
  return (
    <label>
      {label}
      <input
        required
        inputMode="numeric"
        placeholder="09:00"
        pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
        title="Use HH:MM; 24:00 is allowed only for the end"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseMinute(event.target.value));
        }}
      />
    </label>
  );
}
function Windows({
  items,
  onChange,
  prefix,
}: {
  items: Interval[];
  onChange: (items: Interval[]) => void;
  prefix: string;
}) {
  return (
    <>
      {items.map((item, index) => (
        <div className="hours-row" key={`${prefix}-${index}-${items.length}`}>
          <TimeField
            label={`${prefix} start ${index + 1}`}
            value={item.start}
            onChange={(value) =>
              onChange(
                items.map((i, n) => (n === index ? { ...i, start: value } : i)),
              )
            }
          />
          <TimeField
            label={`${prefix} end ${index + 1}`}
            value={item.end}
            onChange={(value) =>
              onChange(
                items.map((i, n) => (n === index ? { ...i, end: value } : i)),
              )
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(items.filter((_, n) => n !== index))}
          >
            Remove {prefix.toLowerCase()} interval {index + 1}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={items.length >= 12}
        onClick={() => onChange([...items, { start: 540, end: 1020 }])}
      >
        Add {prefix.toLowerCase()} interval
      </Button>
    </>
  );
}
function Preview({
  workspace,
  location,
}: {
  workspace: Workspace;
  location: Location;
}) {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const query = useQuery({
    queryKey: [
      'operating-preview',
      workspace.id,
      location.id,
      location.version,
      day,
    ],
    queryFn: async () =>
      previewSchema.parse(
        await api(
          `/workspaces/${workspace.id}/locations/${location.id}/preview?start=${day}&days=7`,
        ),
      ),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(day),
  });
  const local = (instant: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: location.timezone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'shortOffset',
    }).format(new Date(instant));
  return (
    <section className="panel operating-preview">
      <h3>Saved operating-hours preview</h3>
      <p>
        Preview covers seven days using saved rules. These are opening hours,
        not available appointments. Repeated autumn hours remain continuously
        open through both clock occurrences. A nonexistent boundary closes the
        date with a warning until special hours are configured.
      </p>
      <label>
        Preview from
        <input
          type="date"
          min="1900-01-01"
          max="2100-12-31"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      {query.isFetching && <p role="status">Loading preview…</p>}
      {query.isError && <p role="alert">{errorMessage(query.error)}</p>}
      <ul>
        {query.data?.map((item) => (
          <li key={item.day}>
            <strong>{item.day}</strong> · {item.source} {item.label}
            {item.issue ? (
              <p role="alert">{item.issue}</p>
            ) : item.intervals.length ? (
              item.intervals.map((i) => (
                <p key={i.start}>
                  {local(i.start)} – {local(i.end)}
                </p>
              ))
            ) : (
              <p>Closed</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
export function LocationEditor({
  workspace,
  initial,
  onSaved,
  onClose,
}: {
  workspace: Workspace;
  initial: Location;
  onSaved: (location: Location) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const readOnly = workspace.role !== 'owner';
  const save = useMutation({
    mutationFn: async () => {
      const result = locationSchema.safeParse(form);
      if (!result.success)
        throw new Error(result.error.issues.map((i) => i.message).join(' '));
      const { id, ...body } = result.data;
      return locationSchema.parse(
        await api(
          `/workspaces/${workspace.id}/locations${id ? '/' + id : ''}`,
          id ? 'PATCH' : 'POST',
          body,
        ),
      );
    },
    onSuccess: (data) => {
      setForm(data);
      setSaved(data);
      onSaved(data);
    },
  });
  return (
    <>
      <form
        className="panel settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="settings-heading">
          <h2>{form.id ? `Location: ${form.name}` : 'New location'}</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (
                JSON.stringify(form) === JSON.stringify(saved) ||
                window.confirm('Discard unsaved location changes?')
              )
                onClose();
            }}
          >
            Close editor
          </Button>
        </div>
        <fieldset disabled={readOnly || save.isPending}>
          <div className="settings-grid">
            <label>
              Location name
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Location time zone
              <input
                required
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              />
            </label>
          </div>
          <label>
            Address
            <textarea
              maxLength={500}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Location is active
          </label>
          <h3>Weekly opening hours</h3>
          <p>
            Use HH:MM, with 24:00 for an end at midnight. Add multiple intervals
            for breaks. Split overnight hours into two days. Days without
            intervals are closed.
          </p>
          {weekdays.map((name, weekday) => (
            <section className="day-rules" key={name}>
              <h4>{name}</h4>
              <Windows
                prefix={name}
                items={form.weekly.filter((i) => i.weekday === weekday)}
                onChange={(items) =>
                  setForm({
                    ...form,
                    weekly: [
                      ...form.weekly.filter((i) => i.weekday !== weekday),
                      ...items.map((i) => ({ ...i, weekday })),
                    ],
                  })
                }
              />
            </section>
          ))}
          <h3>Holidays &amp; special hours</h3>
          <p>
            A holiday closes the date. Special hours replace all weekly
            intervals for that date. Each date can have one exception.
          </p>
          {form.exceptions.map((exception, index) => {
            const change = (data: Partial<typeof exception>) =>
              setForm({
                ...form,
                exceptions: form.exceptions.map((e, n) =>
                  n === index ? { ...e, ...data } : e,
                ),
              });
            return (
              <section
                className="day-rules"
                key={`${index}-${form.exceptions.length}`}
              >
                <div className="settings-grid">
                  <label>
                    Exception date {index + 1}
                    <input
                      type="date"
                      min="1900-01-01"
                      max="2100-12-31"
                      required
                      value={exception.day}
                      onChange={(e) => change({ day: e.target.value })}
                    />
                  </label>
                  <label>
                    Exception type {index + 1}
                    <select
                      value={exception.kind}
                      onChange={(e) => {
                        const kind = e.target.value as 'holiday' | 'special';
                        change({
                          kind,
                          intervals:
                            kind === 'holiday'
                              ? []
                              : [{ start: 540, end: 1020 }],
                        });
                      }}
                    >
                      <option value="holiday">Holiday / closed</option>
                      <option value="special">Special opening hours</option>
                    </select>
                  </label>
                  <label>
                    Exception label {index + 1}
                    <input
                      maxLength={100}
                      value={exception.label}
                      onChange={(e) => change({ label: e.target.value })}
                    />
                  </label>
                </div>
                {exception.kind === 'special' && (
                  <Windows
                    prefix={`Exception ${index + 1}`}
                    items={exception.intervals}
                    onChange={(intervals) => change({ intervals })}
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      ...form,
                      exceptions: form.exceptions.filter((_, n) => n !== index),
                    })
                  }
                >
                  Remove exception {index + 1}
                </Button>
              </section>
            );
          })}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={form.exceptions.length >= 366}
              onClick={() =>
                setForm({
                  ...form,
                  exceptions: [
                    ...form.exceptions,
                    { day: '', kind: 'holiday', label: '', intervals: [] },
                  ],
                })
              }
            >
              Add dated exception
            </Button>
            {!readOnly && (
              <Button disabled={save.isPending}>Save location</Button>
            )}
          </div>
        </fieldset>
        {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
        {save.isSuccess && <p role="status">Location saved.</p>}
      </form>
      {saved.id && <Preview workspace={workspace} location={saved} />}
    </>
  );
}
