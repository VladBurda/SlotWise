import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { api, errorMessage, workspaceSchema, type Workspace } from './api';
import { workspaceFormSchema, type WorkspaceValues } from './forms';

export function WorkspaceForm({
  onCreated,
  onCancel,
}: {
  onCreated: (workspace: Workspace) => void;
  onCancel?: () => void;
}) {
  const [error, setError] = useState('');
  const form = useForm<WorkspaceValues>({
    resolver: zodResolver(workspaceFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
  });
  return (
    <section className="panel workspace-form">
      <p className="eyebrow">MAKE ROOM FOR YOUR TEAM</p>
      <h2>Create a workspace</h2>
      <p>Give your business its own home. You’ll be its first owner.</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <form
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setError('');
          try {
            onCreated(
              workspaceSchema.parse(await api('/workspaces', 'POST', values)),
            );
          } catch (cause) {
            setError(errorMessage(cause));
          }
        })}
      >
        <label>
          Workspace name
          <input {...form.register('name')} />
          <small role="alert">{form.formState.errors.name?.message}</small>
        </label>
        <label>
          Workspace address
          <input {...form.register('slug')} placeholder="your-business" />
          <small>Lowercase letters, numbers and hyphens.</small>
          <small role="alert">{form.formState.errors.slug?.message}</small>
        </label>
        <label>
          Time zone
          <input {...form.register('timezone')} placeholder="Europe/Berlin" />
          <small role="alert">{form.formState.errors.timezone?.message}</small>
        </label>
        <div className="form-actions">
          <Button disabled={form.formState.isSubmitting}>
            Create workspace
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
