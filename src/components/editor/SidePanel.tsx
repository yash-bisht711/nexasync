'use client';
import { useEffect, useState } from 'react';
import { initials } from './collaboration';

type Comment = { id: string; body: string; author: { id: string; name: string }; createdAt: string };
type Version = { id: string; label: string | null; createdAt: string };

type Props = {
  pageId: string;
  panel: 'comments' | 'history';
  setPanel: (panel: 'comments' | 'history') => void;
  canComment: boolean;
  canRestore: boolean;
  onRestore: (snapshot: unknown) => void | Promise<void>;
  refreshKey: number;
  colorFor: (seed: string) => string;
};

export default function SidePanel({ pageId, panel, setPanel, canComment, canRestore, onRestore, refreshKey, colorFor }: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`/api/pages/${pageId}/comments`)
      .then(r => (r.ok ? r.json() : { comments: [] }))
      .then(data => active && setComments(data.comments || []));
    fetch(`/api/pages/${pageId}/versions`)
      .then(r => (r.ok ? r.json() : { versions: [] }))
      .then(data => active && setVersions(data.versions || []));
    return () => {
      active = false;
    };
    // refreshKey bumps after a snapshot is written, otherwise the history tab keeps showing
    // the list captured before that snapshot existed.
  }, [pageId, refreshKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const res = await fetch(`/api/pages/${pageId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not post comment');
      return;
    }
    setError('');
    setComments(list => [...list, data.comment]);
    setDraft('');
  }

  // The list endpoint omits snapshot bodies, so the chosen version is fetched on demand.
  async function restore(version: Version) {
    const when = new Date(version.createdAt).toLocaleString();
    if (!window.confirm(`Restore “${version.label || 'Saved version'}” from ${when}? The current content is replaced.`)) return;
    setRestoring(version.id);
    setError('');
    try {
      const res = await fetch(`/api/pages/${pageId}/versions/${version.id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load that version');
        return;
      }
      await onRestore(data.version.snapshot);
    } finally {
      setRestoring('');
    }
  }

  const tab = (key: 'comments' | 'history', label: string, count: number) => (    <button
      type="button"
      onClick={() => setPanel(key)}
      className={`flex-1 rounded-lg py-2 text-xs transition ${
        panel === key ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
      {count > 0 && <span className="ml-1.5 text-[10px] text-slate-500">{count}</span>}
    </button>
  );

  return (
    <aside className="surface h-fit rounded-2xl p-4">
      <div className="flex gap-2 border-b border-white/5 pb-3">
        {tab('comments', 'Comments', comments.length)}
        {tab('history', 'History', versions.length)}
      </div>

      {panel === 'history' ? (
        <div className="pt-4">
          <h3 className="font-semibold">Version history</h3>
          <p className="mt-1 text-xs text-slate-500">Manual snapshots of this document.</p>
          {canRestore && <p className="mt-1 text-xs text-amber-300/80">Restoring replaces the live content and cannot be undone with Ctrl+Z.</p>}
          <div className="mt-3 space-y-2">
            {versions.map(version => (
              <div key={version.id} className="rounded-xl bg-white/[.03] p-3">
                <div className="text-sm">{version.label || 'Saved version'}</div>
                <div className="mt-1 text-xs text-slate-500">{new Date(version.createdAt).toLocaleString()}</div>
                {canRestore && (
                  <button
                    type="button"
                    onClick={() => restore(version)}
                    disabled={!!restoring}
                    className="mt-2 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/25 disabled:opacity-40"
                  >
                    {restoring === version.id ? 'Restoring…' : 'Restore'}
                  </button>
                )}
              </div>
            ))}
            {!versions.length && <p className="text-sm text-slate-500">No snapshots yet.</p>}
          </div>
          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        </div>
      ) : (
        <div className="pt-4">
          <h3 className="font-semibold">Discussion</h3>
          <div className="mt-3 space-y-3">
            {comments.map(comment => (
              <div key={comment.id} className="rounded-xl bg-white/[.03] p-3">
                <div className="flex items-center gap-2">
                  <span
                    style={{ backgroundColor: colorFor(comment.author.id) }}
                    className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-[#0b0e17]"
                  >
                    {initials(comment.author.name)}
                  </span>
                  <span className="text-xs font-semibold text-violet-200">{comment.author.name}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{comment.body}</p>
                <div className="mt-2 text-[10px] text-slate-600">{new Date(comment.createdAt).toLocaleString()}</div>
              </div>
            ))}
            {!comments.length && <p className="text-sm text-slate-500">No comments yet. Start the conversation.</p>}
          </div>

          {canComment ? (
            <form onSubmit={submit} className="mt-4">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                maxLength={2000}
                placeholder="Write a comment…"
                className="min-h-24 w-full resize-y rounded-xl border border-white/10 bg-[#0b0e17] p-3 text-sm outline-none focus:border-violet-400"
              />
              <button className="mt-2 w-full rounded-xl bg-violet-500/20 p-2 text-sm text-violet-200 hover:bg-violet-500/30">
                Post comment
              </button>
              {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
            </form>
          ) : (
            <p className="mt-4 text-xs text-slate-500">Your role can read this page but not comment.</p>
          )}
        </div>
      )}
    </aside>
  );
}
