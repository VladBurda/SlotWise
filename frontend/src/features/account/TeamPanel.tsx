import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  api,
  errorMessage,
  invitationSchema,
  memberSchema,
  roleSchema,
  type Member,
  type Role,
  type Workspace,
} from './api';

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  role: roleSchema,
});
const roles: Role[] = ['owner', 'manager', 'employee', 'customer'];

function MemberRow({
  member,
  workspace,
  onChange,
}: {
  member: Member;
  workspace: Workspace;
  onChange: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const update = useMutation({
    mutationFn: (remove: boolean) =>
      api(
        `/workspaces/${workspace.id}/members/${member.user_id}`,
        remove ? 'DELETE' : 'PATCH',
        remove ? undefined : { role },
      ),
    onSuccess: onChange,
  });
  return (
    <li className="member-row">
      <div>
        <strong>{member.name}</strong>
        <small>{member.email}</small>
      </div>
      {workspace.role === 'owner' ? (
        <div className="member-actions">
          <label className="sr-only" htmlFor={`role-${member.user_id}`}>
            Role for {member.email}
          </label>
          <select
            id={`role-${member.user_id}`}
            value={role}
            onChange={(event) => setRole(roleSchema.parse(event.target.value))}
          >
            {roles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending || role === member.role}
            onClick={() => update.mutate(false)}
          >
            Save role
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => {
              if (window.confirm(`Remove ${member.email} from this workspace?`))
                update.mutate(true);
            }}
          >
            Remove
          </Button>
        </div>
      ) : (
        <span className="badge success">{member.role}</span>
      )}
      {update.isError && (
        <p role="alert" className="form-error">
          {errorMessage(update.error)}
        </p>
      )}
    </li>
  );
}

export function TeamPanel({ workspace }: { workspace: Workspace }) {
  const cache = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [inviteOffset, setInviteOffset] = useState(0);
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'employee' },
  });
  const members = useQuery({
    queryKey: ['members', workspace.id, offset],
    queryFn: async () =>
      z
        .array(memberSchema)
        .parse(
          await api(
            `/workspaces/${workspace.id}/members?offset=${offset}&limit=20`,
          ),
        ),
  });
  const invitations = useQuery({
    queryKey: ['invitations', workspace.id, inviteOffset],
    queryFn: async () =>
      z
        .array(invitationSchema)
        .parse(
          await api(
            `/workspaces/${workspace.id}/invitations?offset=${inviteOffset}&limit=20`,
          ),
        ),
    enabled: workspace.role === 'owner',
  });
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['members', workspace.id] });
    void cache.invalidateQueries({ queryKey: ['invitations', workspace.id] });
    void cache.invalidateQueries({ queryKey: ['workspaces'] });
  };
  const invite = useMutation({
    mutationFn: (values: z.infer<typeof inviteSchema>) =>
      api(`/workspaces/${workspace.id}/invitations`, 'POST', values),
    onSuccess: () => {
      form.reset();
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/workspaces/${workspace.id}/invitations/${id}`, 'DELETE'),
    onSuccess: refresh,
  });

  return (
    <div className="team-layout">
      <section className="panel">
        <p className="eyebrow">PEOPLE & PERMISSIONS</p>
        <h2>Your team</h2>
        <p>Roles apply only within {workspace.name}.</p>
        {members.isPending && <p role="status">Loading members…</p>}
        {members.isError && (
          <p role="alert" className="form-error">
            {errorMessage(members.error)}
          </p>
        )}
        <ul className="member-list">
          {members.data?.map((member) => (
            <MemberRow
              key={`${member.user_id}-${member.role}`}
              member={member}
              workspace={workspace}
              onChange={refresh}
            />
          ))}
        </ul>
        <div className="pagination">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(offset - 20)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={(members.data?.length ?? 0) < 20}
            onClick={() => setOffset(offset + 20)}
          >
            Next
          </Button>
        </div>
      </section>
      {workspace.role === 'owner' && (
        <section className="panel">
          <p className="eyebrow">GROW TOGETHER</p>
          <h2>Invite a teammate</h2>
          <p>They’ll receive a secure invitation, valid for seven days.</p>
          <form
            noValidate
            onSubmit={form.handleSubmit((values) => invite.mutate(values))}
          >
            <label>
              Teammate email
              <input type="email" {...form.register('email')} />
              <small role="alert">{form.formState.errors.email?.message}</small>
            </label>
            <label>
              Workspace role
              <select {...form.register('role')}>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <small>
              Owners manage membership. Managers can view the team. Employees
              and customers can view their own workspace.
            </small>
            <Button disabled={invite.isPending}>Send invitation</Button>
          </form>
          {invite.isSuccess && (
            <p role="status" className="form-success">
              Invitation queued for email delivery.
            </p>
          )}
          {invite.isError && (
            <p role="alert" className="form-error">
              {errorMessage(invite.error)}
            </p>
          )}
          <h3 className="invites-heading">Invitations</h3>
          {invitations.isPending && <p role="status">Loading invitations…</p>}
          {invitations.isError && (
            <p role="alert">{errorMessage(invitations.error)}</p>
          )}
          {invitations.data?.length === 0 && <p>No invitations yet.</p>}
          <ul className="member-list">
            {invitations.data?.map((item) => {
              const status = item.accepted
                ? 'Accepted'
                : item.revoked
                  ? 'Revoked'
                  : Date.parse(item.expires_at) < Date.now()
                    ? 'Expired'
                    : 'Pending';
              return (
                <li className="member-row" key={item.id}>
                  <div>
                    <strong>{item.email}</strong>
                    <small>
                      {item.role} · {status}
                    </small>
                  </div>
                  {status === 'Pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Revoke the invitation for ${item.email}?`,
                          )
                        )
                          revoke.mutate(item.id);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {revoke.isError && <p role="alert">{errorMessage(revoke.error)}</p>}
          <div className="pagination">
            <Button
              variant="outline"
              disabled={inviteOffset === 0}
              onClick={() => setInviteOffset(inviteOffset - 20)}
            >
              Previous invitations
            </Button>
            <Button
              variant="outline"
              disabled={(invitations.data?.length ?? 0) < 20}
              onClick={() => setInviteOffset(inviteOffset + 20)}
            >
              Next invitations
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
