import { useEffect, useState } from 'react';
import type { Availability } from './contracts';
import {
  weekdays,
  formatMinute,
  parseMinute,
} from '@/features/business/contracts';
import { Button } from '@/components/ui/button';

function MinuteInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const [text, setText] = useState(formatMinute(value));
  useEffect(() => setText(formatMinute(value)), [value]);
  return (
    <input
      aria-label={label}
      required
      value={text}
      placeholder="HH:MM"
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const minute = parseMinute(next);
        e.target.setCustomValidity(
          Number.isFinite(minute)
            ? ''
            : 'Enter HH:MM; use 24:00 only for an end.',
        );
        if (Number.isFinite(minute)) onChange(minute);
      }}
    />
  );
}

export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (value: Availability) => void;
}) {
  return (
    <section className="schedule-editor">
      <h3>Working hours & availability</h3>
      <p>
        Hours use the location’s time zone and are limited by business opening
        hours. Days without hours are closed. Dated hours replace weekly hours
        and breaks.
      </p>
      {(['weekly', 'breaks'] as const).map((key) => (
        <section key={key}>
          <h4>{key === 'weekly' ? 'Weekly hours' : 'Weekly breaks'}</h4>
          {value[key].map((row, index) => (
            <div className="catalog-row" key={index}>
              <label>
                Day
                <select
                  value={row.weekday}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: value[key].map((r, i) =>
                        i === index
                          ? { ...r, weekday: Number(e.target.value) }
                          : r,
                      ),
                    })
                  }
                >
                  {weekdays.map((day, i) => (
                    <option key={day} value={i}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start
                <MinuteInput
                  label={`${key} start ${index + 1}`}
                  value={row.start}
                  onChange={(start) =>
                    onChange({
                      ...value,
                      [key]: value[key].map((r, i) =>
                        i === index ? { ...r, start } : r,
                      ),
                    })
                  }
                />
              </label>
              <label>
                End
                <MinuteInput
                  label={`${key} end ${index + 1}`}
                  value={row.end}
                  onChange={(end) =>
                    onChange({
                      ...value,
                      [key]: value[key].map((r, i) =>
                        i === index ? { ...r, end } : r,
                      ),
                    })
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...value,
                    [key]: value[key].filter((_, i) => i !== index),
                  })
                }
              >
                Remove {key === 'weekly' ? 'hours' : 'break'}
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({
                ...value,
                [key]: [
                  ...value[key],
                  {
                    weekday: 0,
                    start: key === 'weekly' ? 540 : 720,
                    end: key === 'weekly' ? 1020 : 780,
                  },
                ],
              })
            }
          >
            Add {key === 'weekly' ? 'working hours' : 'break'}
          </Button>
        </section>
      ))}
      <h4>Dated exceptions</h4>
      {value.exceptions.map((row, index) => (
        <div className="catalog-subpanel" key={index}>
          <div className="catalog-row">
            <label>
              Date
              <input
                type="date"
                required
                value={row.day}
                onChange={(e) =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.map((r, i) =>
                      i === index ? { ...r, day: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <label>
              Schedule
              <select
                value={row.kind}
                onChange={(e) =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            kind:
                              e.target.value === 'holiday'
                                ? 'holiday'
                                : 'special',
                            intervals:
                              e.target.value === 'holiday'
                                ? []
                                : [{ start: 540, end: 1020 }],
                          }
                        : r,
                    ),
                  })
                }
              >
                <option value="holiday">Closed</option>
                <option value="special">Special hours</option>
              </select>
            </label>
            <label>
              Label
              <input
                maxLength={100}
                value={row.label}
                onChange={(e) =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.map((r, i) =>
                      i === index ? { ...r, label: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  exceptions: value.exceptions.filter((_, i) => i !== index),
                })
              }
            >
              Remove exception
            </Button>
          </div>
          {row.intervals.map((window, wi) => (
            <div className="catalog-row" key={wi}>
              {(['start', 'end'] as const).map((boundary) => (
                <label key={boundary}>
                  Special {boundary}
                  <MinuteInput
                    value={window[boundary]}
                    onChange={(minute) =>
                      onChange({
                        ...value,
                        exceptions: value.exceptions.map((r, i) =>
                          i === index
                            ? {
                                ...r,
                                intervals: r.intervals.map((w, j) =>
                                  j === wi ? { ...w, [boundary]: minute } : w,
                                ),
                              }
                            : r,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...value,
                    exceptions: value.exceptions.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            intervals: r.intervals.filter((_, j) => j !== wi),
                          }
                        : r,
                    ),
                  })
                }
              >
                Remove window
              </Button>
            </div>
          ))}
          {row.kind === 'special' && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  exceptions: value.exceptions.map((r, i) =>
                    i === index
                      ? {
                          ...r,
                          intervals: [
                            ...r.intervals,
                            { start: 540, end: 1020 },
                          ],
                        }
                      : r,
                  ),
                })
              }
            >
              Add special window
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          onChange({
            ...value,
            exceptions: [
              ...value.exceptions,
              { day: '', kind: 'holiday', label: '', intervals: [] },
            ],
          })
        }
      >
        Add dated exception
      </Button>
      <h4>Time off / maintenance</h4>
      <p>
        Record approved leave or maintenance here. Enter UTC dates and times;
        the preview displays the location’s time zone.
      </p>
      {value.unavailable.map((row, index) => (
        <div className="catalog-row" key={index}>
          {(['start', 'end'] as const).map((boundary) => (
            <label key={boundary}>
              Unavailable {boundary} (UTC)
              <input
                required
                type="datetime-local"
                value={row[boundary].slice(0, 16)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    unavailable: value.unavailable.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            [boundary]: e.target.value
                              ? `${e.target.value}:00Z`
                              : '',
                          }
                        : r,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            Reason
            <input
              maxLength={200}
              value={row.reason}
              onChange={(e) =>
                onChange({
                  ...value,
                  unavailable: value.unavailable.map((r, i) =>
                    i === index ? { ...r, reason: e.target.value } : r,
                  ),
                })
              }
            />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({
                ...value,
                unavailable: value.unavailable.filter((_, i) => i !== index),
              })
            }
          >
            Remove unavailable period
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          onChange({
            ...value,
            unavailable: [
              ...value.unavailable,
              { start: '', end: '', reason: '' },
            ],
          })
        }
      >
        Add unavailable period
      </Button>
    </section>
  );
}
