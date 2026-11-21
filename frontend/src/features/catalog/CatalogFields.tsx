import type { CatalogData, CatalogItem } from './contracts';
import type { Location } from '@/features/business/contracts';
import { Button } from '@/components/ui/button';
import { AvailabilityEditor } from './AvailabilityEditor';

export function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string; active?: boolean }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="catalog-choices">
      <legend>{label}</legend>
      {!options.length && (
        <p>No options yet. Add them in the corresponding section first.</p>
      )}
      {options.map((option) => (
        <label key={option.id} className="checkbox-label">
          <input
            type="checkbox"
            checked={value.includes(option.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, option.id]
                  : value.filter((id) => id !== option.id),
              )
            }
          />
          {option.name}
          {option.active === false ? ' (inactive)' : ''}
        </label>
      ))}
    </fieldset>
  );
}

export function CatalogFields({
  data,
  onChange,
  items,
  locations,
}: {
  data: CatalogData;
  onChange: (data: CatalogData) => void;
  items: CatalogItem[];
  locations: Location[];
}) {
  const options = (kind: CatalogData['kind']) =>
    items
      .filter((item) => item.data.kind === kind)
      .map((item) => ({
        id: item.id,
        name: item.data.name,
        active: item.data.active,
      }));
  const locationOptions = locations.flatMap((l) =>
    l.id
      ? [{ id: l.id, name: `${l.name} · ${l.timezone}`, active: l.active }]
      : [],
  );
  return (
    <>
      <div className="settings-grid">
        <label>
          Name
          <input
            required
            maxLength={100}
            value={data.name}
            onChange={(e) => onChange({ ...data, name: e.target.value })}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={data.active}
            onChange={(e) => onChange({ ...data, active: e.target.checked })}
          />
          Active
        </label>
        {'location_id' in data && (
          <label>
            Location
            <select
              required
              value={data.location_id}
              onChange={(e) =>
                onChange({ ...data, location_id: e.target.value })
              }
            >
              <option value="">Select location</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {!l.active ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {'resource_type' in data && (
          <label>
            Resource type
            <input
              required
              pattern="[a-z][a-z0-9_-]*"
              maxLength={50}
              value={data.resource_type}
              onChange={(e) =>
                onChange({ ...data, resource_type: e.target.value })
              }
            />
            <small>For example: room, repair_bay, diagnostic_device.</small>
          </label>
        )}
        {'capacity' in data && (
          <label>
            Capacity
            <input
              required
              type="number"
              min={1}
              max={100}
              step={1}
              value={data.capacity}
              onChange={(e) =>
                onChange({ ...data, capacity: e.target.valueAsNumber })
              }
            />
            <small>
              Simultaneous capacity units, not the number of separate assets.
            </small>
          </label>
        )}
        {data.kind === 'staff' && (
          <label>
            Job title
            <input
              maxLength={100}
              value={data.title}
              onChange={(e) => onChange({ ...data, title: e.target.value })}
            />
          </label>
        )}
      </div>
      {'description' in data && (
        <label>
          Description
          <textarea
            maxLength={2000}
            value={data.description}
            onChange={(e) => onChange({ ...data, description: e.target.value })}
          />
        </label>
      )}
      {data.kind === 'staff' && (
        <>
          <Choices
            label="Qualifications"
            options={options('skills')}
            value={data.qualifications.map((q) => q.skill_id)}
            onChange={(ids) =>
              onChange({
                ...data,
                qualifications: ids.map(
                  (skill_id) =>
                    data.qualifications.find(
                      (q) => q.skill_id === skill_id,
                    ) ?? { skill_id, valid_until: null },
                ),
              })
            }
          />
          {data.qualifications.map((q) => (
            <label key={q.skill_id}>
              {items.find((i) => i.id === q.skill_id)?.data.name} valid through
              (optional)
              <input
                type="date"
                value={q.valid_until ?? ''}
                onChange={(e) =>
                  onChange({
                    ...data,
                    qualifications: data.qualifications.map((v) =>
                      v.skill_id === q.skill_id
                        ? { ...v, valid_until: e.target.value || null }
                        : v,
                    ),
                  })
                }
              />
            </label>
          ))}
          <p>
            Staff profiles describe scheduling roles. Account permissions are
            managed separately in Team.
          </p>
        </>
      )}
      {data.kind === 'resources' && (
        <section>
          <h3>Attributes</h3>
          {Object.entries(data.attributes).map(([key, value], index) => (
            <div className="catalog-row" key={index}>
              <label>
                Attribute name
                <input
                  required
                  maxLength={100}
                  value={key}
                  onChange={(e) => {
                    const entries = Object.entries(data.attributes);
                    entries[index] = [e.target.value, value];
                    onChange({
                      ...data,
                      attributes: Object.fromEntries(entries),
                    });
                  }}
                />
              </label>
              <label>
                Attribute value
                <input
                  maxLength={500}
                  value={value}
                  onChange={(e) =>
                    onChange({
                      ...data,
                      attributes: { ...data.attributes, [key]: e.target.value },
                    })
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...data,
                    attributes: Object.fromEntries(
                      Object.entries(data.attributes).filter(
                        ([k]) => k !== key,
                      ),
                    ),
                  })
                }
              >
                Remove attribute
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({
                ...data,
                attributes: {
                  ...data.attributes,
                  [`attribute_${Object.keys(data.attributes).length + 1}`]: '',
                },
              })
            }
          >
            Add attribute
          </Button>
        </section>
      )}
      {data.kind === 'pools' && (
        <Choices
          label="Pool members (same location and type)"
          options={items
            .filter(
              (i) =>
                i.data.kind === 'resources' &&
                i.data.location_id === data.location_id &&
                i.data.resource_type === data.resource_type,
            )
            .map((i) => ({
              id: i.id,
              name: i.data.name,
              active: i.data.active,
            }))}
          value={data.resource_ids}
          onChange={(resource_ids) => onChange({ ...data, resource_ids })}
        />
      )}
      {(data.kind === 'staff' || data.kind === 'resources') && (
        <AvailabilityEditor
          value={data.availability}
          onChange={(availability) => onChange({ ...data, availability })}
        />
      )}
      {data.kind === 'services' && (
        <>
          <h3>Duration & price</h3>
          <p>
            Fixed duration: set minimum and maximum to the same value. Price is
            an estimate; no payment is collected.
          </p>
          <div className="settings-grid">
            {(
              [
                ['duration_minutes', 'Minimum duration (minutes)', 5, 1440],
                [
                  'maximum_duration_minutes',
                  'Maximum duration (minutes)',
                  5,
                  1440,
                ],
                ['duration_step_minutes', 'Duration step (minutes)', 1, 120],
                [
                  'buffer_before_minutes',
                  'Preparation buffer (minutes)',
                  0,
                  1440,
                ],
                ['buffer_after_minutes', 'Cleanup buffer (minutes)', 0, 1440],
                [
                  'price_minor',
                  'Price in minor units (e.g. 2500 = 25.00 EUR)',
                  0,
                  100000000,
                ],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  step={1}
                  value={data[key]}
                  onChange={(e) =>
                    onChange({ ...data, [key]: e.target.valueAsNumber })
                  }
                />
              </label>
            ))}
            <label>
              Currency
              <select
                value={data.currency}
                onChange={(e) => {
                  const currency = e.target.value;
                  if (
                    currency === 'EUR' ||
                    currency === 'USD' ||
                    currency === 'GBP' ||
                    currency === 'CAD' ||
                    currency === 'AUD' ||
                    currency === 'CHF' ||
                    currency === 'JPY' ||
                    currency === 'UAH'
                  )
                    onChange({ ...data, currency });
                }}
              >
                {['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'UAH'].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Minimum notice override (minutes)
              <input
                type="number"
                min={0}
                max={525600}
                step={1}
                placeholder="Use business policy"
                value={data.minimum_notice_minutes ?? ''}
                onChange={(e) =>
                  onChange({
                    ...data,
                    minimum_notice_minutes:
                      e.target.value === '' ? null : e.target.valueAsNumber,
                  })
                }
              />
            </label>
          </div>
          <Choices
            label="Available locations"
            options={locationOptions}
            value={data.location_ids}
            onChange={(location_ids) => onChange({ ...data, location_ids })}
          />
          <Choices
            label="Required skills (all must match)"
            options={options('skills')}
            value={data.skill_ids}
            onChange={(skill_ids) => onChange({ ...data, skill_ids })}
          />
          <Choices
            label="Eligible staff (empty means all qualified staff)"
            options={options('staff')}
            value={data.employee_ids}
            onChange={(employee_ids) => onChange({ ...data, employee_ids })}
          />
          <Choices
            label="Compatible resources (empty means all matching resources)"
            options={options('resources')}
            value={data.compatible_resource_ids}
            onChange={(compatible_resource_ids) =>
              onChange({ ...data, compatible_resource_ids })
            }
          />
          <h3>Resource requirements</h3>
          <p>
            Quantity means distinct assets. Units means capacity consumed on
            each asset. All requirements must be satisfied together when
            booking.
          </p>
          {data.requirements.map((req, index) => {
            const update = (next: typeof req) =>
              onChange({
                ...data,
                requirements: data.requirements.map((r, i) =>
                  i === index ? next : r,
                ),
              });
            const selector =
              req.resource_id !== null
                ? 'resource'
                : req.pool_id !== null
                  ? 'pool'
                  : 'type';
            return (
              <div className="catalog-subpanel" key={index}>
                <div className="settings-grid">
                  <label>
                    Requirement selector
                    <select
                      value={selector}
                      onChange={(e) =>
                        update({
                          ...req,
                          resource_id:
                            e.target.value === 'resource' ? '' : null,
                          pool_id: e.target.value === 'pool' ? '' : null,
                          resource_type:
                            e.target.value === 'type' ? 'room' : null,
                          quantity: 1,
                        })
                      }
                    >
                      <option value="type">Resource type</option>
                      <option value="resource">Specific resource</option>
                      <option value="pool">Resource pool</option>
                    </select>
                  </label>
                  {selector === 'type' ? (
                    <label>
                      Required resource type
                      <input
                        required
                        pattern="[a-z][a-z0-9_-]*"
                        value={req.resource_type ?? ''}
                        onChange={(e) =>
                          update({ ...req, resource_type: e.target.value })
                        }
                      />
                    </label>
                  ) : (
                    <label>
                      {selector === 'pool'
                        ? 'Required pool'
                        : 'Required resource'}
                      <select
                        required
                        value={req.resource_id ?? req.pool_id ?? ''}
                        onChange={(e) =>
                          update({
                            ...req,
                            resource_id:
                              selector === 'resource' ? e.target.value : null,
                            pool_id:
                              selector === 'pool' ? e.target.value : null,
                          })
                        }
                      >
                        <option value="">Choose an option</option>
                        {options(
                          selector === 'pool' ? 'pools' : 'resources',
                        ).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Asset quantity
                    <input
                      type="number"
                      required
                      min={1}
                      max={selector === 'resource' ? 1 : 100}
                      value={req.quantity}
                      onChange={(e) =>
                        update({ ...req, quantity: e.target.valueAsNumber })
                      }
                    />
                  </label>
                  <label>
                    Units per asset
                    <input
                      type="number"
                      required
                      min={1}
                      max={100}
                      value={req.units_per_resource}
                      onChange={(e) =>
                        update({
                          ...req,
                          units_per_resource: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    onChange({
                      ...data,
                      requirements: data.requirements.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  Remove requirement
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({
                ...data,
                requirements: [
                  ...data.requirements,
                  {
                    resource_id: null,
                    pool_id: null,
                    resource_type: 'room',
                    quantity: 1,
                    units_per_resource: 1,
                  },
                ],
              })
            }
          >
            Add resource requirement
          </Button>
        </>
      )}
    </>
  );
}
