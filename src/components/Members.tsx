'use client';
import { useEffect, useState } from 'react';
import { Plus, Users } from 'lucide-react';

type Member = { id: string; role: string; userId: string; user: { name: string; email: string } };
const ROLES = ['OWNER', 'EDITOR', 'COMMENTER', 'VIEWER'];

type Props = {
  workspaceId: string;
  isOwner: boolean;
  viewerId: string;
  onCountChange: (count: number) => void;
};

export default function Members({ workspaceId, isOwner, viewerId, onCountChange }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('EDITOR');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/workspaces/${workspaceId}/members`)
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(data => {
        if (!active) return;
        setMembers(data.members || []);
        onCountChange(data.members?.length || 0);
      });
    return () => {
      active = false;
    };
    // onCountChange is a stable state setter from Dashboard; re-running on identity changes
    // would refetch the list on every parent render.
  }, [workspaceId]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error || 'That invite did not go through.');
      return;
    }
    setMembers(list => [...list, data.membership]);
    onCountChange(members.length + 1);
    setEmail('');
    setMessage(`${data.membership.user.name} can now open this workspace.`);
    window.setTimeout(() => setMessage(''), 3000);
  }

  async function updateRole(member: Member, next: string) {
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: next }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error || 'That role change did not go through.');
      return;
    }
    setMembers(list => list.map(m => (m.id === member.id ? data.membership : m)));
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.user.name} from this workspace?`)) return;
    setBusy(true);
    const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error || 'That removal did not go through.');
      return;
    }
    setMembers(list => list.filter(m => m.id !== member.id));
    onCountChange(members.length - 1);
  }

  return (
    <div className="surface mb-6 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <Users size={15} className="text-violet-300" />
        <h2 className="text-sm font-semibold">Members</h2>
        <span className="text-xs text-slate-500">{members.length}</span>
      </div>
      {!isOwner && <p className="mt-1 text-xs text-slate-500">Only the workspace owner can invite or change roles.</p>}

      <ul className="mt-4 space-y-2">
        {members.map(member => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[.03] px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm">
                {member.user.name}
                {member.userId === viewerId && <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">you</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{member.user.email}</div>
            </div>
            {isOwner ? (
              <div className="flex items-center gap-2">
                <select
                  value={member.role}
                  disabled={busy}
                  onChange={e => updateRole(member, e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#0b0e17] px-2 py-1 text-xs outline-none disabled:opacity-50"
                >
                  {ROLES.map(key => (
                    <option key={key} value={key}>
                      {key.toLowerCase()}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || member.userId === viewerId}
                  onClick={() => remove(member)}
                  className="rounded-lg bg-white/5 px-2 py-1 text-xs text-slate-400 hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            ) : (
              <span className="text-xs uppercase tracking-wider text-slate-500">{member.role.toLowerCase()}</span>
            )}
          </li>
        ))}
        {!members.length && <li className="text-sm text-slate-500">No members loaded.</li>}
      </ul>

      {isOwner && (
        <form onSubmit={invite} className="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-4">
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0b0e17] px-3 py-2 text-xs outline-none focus:border-violet-400"
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="rounded-lg border border-white/10 bg-[#0b0e17] px-2 py-2 text-xs outline-none"
          >
            {ROLES.filter(r => r !== 'OWNER').map(key => (
              <option key={key} value={key}>
                {key.toLowerCase()}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/30 disabled:opacity-40"
          >
            <Plus size={14} /> Invite
          </button>
        </form>
      )}
      {message && <p className="mt-3 text-xs text-emerald-300">{message}</p>}
    </div>
  );
}
