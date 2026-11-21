import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, errorMessage, type Workspace } from '@/features/account/api';
import { locationSchema, type Location } from '@/features/business/contracts';
import { Button } from '@/components/ui/button';
import { CatalogFields } from './CatalogFields';
import { CatalogPreview } from './CatalogPreview';
import {
  itemSchema,
  kinds,
  newItem,
  titles,
  validateDraft,
  type CatalogData,
  type CatalogItem,
  type Kind,
} from './contracts';

async function allPages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = z
      .array(schema)
      .parse(await api(`${path}?offset=${offset}&limit=100`));
    result.push(...page);
    if (page.length < 100) return result;
  }
}

export function CatalogEditor({
  initial,
  id,
  workspaceId,
  items,
  locations,
  onSaved,
  onClose,
}: {
  initial: CatalogData;
  id?: string;
  workspaceId: string;
  items: CatalogItem[];
  locations: Location[];
  onSaved: (item: CatalogItem) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState(initial);
  const save = useMutation({
    mutationFn: async () =>
      itemSchema.parse(
        await api(
          `/workspaces/${workspaceId}/catalog/${data.kind}${id ? `/${id}` : ''}`,
          id ? 'PATCH' : 'POST',
          validateDraft(data),
        ),
      ),
    onSuccess: onSaved,
  });
  return (
    <form
      className="panel settings-form catalog-editor"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>
        {id ? 'Edit' : 'Add'} {titles[data.kind].toLowerCase()}
      </h2>
      <fieldset disabled={save.isPending}>
        <CatalogFields
          data={data}
          onChange={setData}
          items={items}
          locations={locations}
        />
        <div className="form-actions">
          <Button disabled={save.isPending}>
            Save {titles[data.kind].toLowerCase()}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (window.confirm('Discard unsaved edits and close?')) onClose();
            }}
          >
            Close editor
          </Button>
        </div>
      </fieldset>
      {save.isError && (
        <p role="alert">
          {errorMessage(save.error)} Use Reload saved catalog if another person
          has changed this record.
        </p>
      )}
    </form>
  );
}

export function CatalogPage({ workspace }: { workspace: Workspace }) {
  const cache = useQueryClient();
  const [kind, setKind] = useState<Kind>('staff');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState('');
  const root = `/workspaces/${workspace.id}`;
  const query = useQuery({
    queryKey: ['catalog', workspace.id],
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [locations, ...groups] = await Promise.all([
        allPages(root + '/locations', locationSchema),
        ...kinds.map((k) => allPages(`${root}/catalog/${k}`, itemSchema)),
      ] as const);
      return { locations, items: groups.flat() };
    },
  });
  if (query.isPending)
    return (
      <section className="panel skeleton" role="status">
        Loading scheduling configuration…
      </section>
    );
  if (query.isError)
    return (
      <section className="panel">
        <p role="alert">{errorMessage(query.error)}</p>
        <Button onClick={() => void query.refetch()}>Retry catalog</Button>
      </section>
    );
  const { items, locations } = query.data;
  const shown = items.filter(
    (i) =>
      i.data.kind === kind &&
      i.data.name.toLowerCase().includes(search.toLowerCase()),
  );
  const changeSection = (next: Kind) => {
    if (
      (selected || creating) &&
      !window.confirm('Close the editor and discard unsaved changes?')
    )
      return;
    setKind(next);
    setSelected(null);
    setCreating(false);
    setSaved('');
  };
  return (
    <div className="business-settings">
      <section className="panel">
        <p className="eyebrow">SCHEDULING SETUP</p>
        <h2>Staff, resources & services</h2>
        <p>
          Build your team’s qualifications, define available assets, and connect
          them to the services you offer.
        </p>
        <nav className="catalog-tabs" aria-label="Catalog sections">
          {kinds.map((k) => (
            <Button
              key={k}
              variant={kind === k ? 'default' : 'outline'}
              onClick={() => changeSection(k)}
            >
              {titles[k]}
            </Button>
          ))}
        </nav>
        <div className="settings-heading">
          <h3>{titles[kind]}</h3>
          <Button
            onClick={() => {
              if (
                (selected || creating) &&
                !window.confirm('Discard unsaved changes and add a new item?')
              )
                return;
              setSelected(null);
              setCreating(true);
              setSaved('');
            }}
          >
            Add {titles[kind].toLowerCase()}
          </Button>
        </div>
        <label>
          Search catalog
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Find ${titles[kind].toLowerCase()}…`}
          />
        </label>
        {!locations.length && (
          <p>
            Add a location in Business settings before configuring staff,
            resources or services.
          </p>
        )}
        {!shown.length && <p>No {titles[kind].toLowerCase()} found.</p>}
        <ul className="location-list">
          {shown.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.data.name}</strong>
                <p>
                  {item.data.active ? 'Active' : 'Inactive'}
                  {'location_id' in item.data
                    ? ` · ${locations.find((l) => 'location_id' in item.data && l.id === item.data.location_id)?.name ?? 'Location'}`
                    : ''}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    (selected || creating) &&
                    !window.confirm(
                      'Discard unsaved changes and open this item?',
                    )
                  )
                    return;
                  setSelected(item);
                  setCreating(false);
                  setSaved('');
                }}
              >
                Edit {item.data.name}
              </Button>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          onClick={() => {
            if (
              !window.confirm(
                'Reload saved catalog? Unsaved changes will be discarded.',
              )
            )
              return;
            setSelected(null);
            setCreating(false);
            setSaved('');
            void query.refetch();
          }}
        >
          Reload saved catalog
        </Button>
        {saved && <p role="status">{saved}</p>}
      </section>
      {(selected || creating) && (
        <CatalogEditor
          key={
            selected
              ? `editor-${selected.id}-${selected.data.version}`
              : `new-${kind}`
          }
          id={selected?.id}
          initial={selected?.data ?? newItem(kind, locations[0]?.id ?? '')}
          workspaceId={workspace.id}
          items={items}
          locations={locations}
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSaved={(item) => {
            setSelected(item);
            setCreating(false);
            setSaved(`${item.data.name} saved.`);
            void cache.invalidateQueries({
              queryKey: ['catalog', workspace.id],
            });
          }}
        />
      )}
      {selected && (
        <CatalogPreview
          key={`preview-${selected.id}-${selected.data.version}`}
          item={selected}
          workspaceId={workspace.id}
          locations={locations}
        />
      )}
    </div>
  );
}
