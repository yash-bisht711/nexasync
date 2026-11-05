'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { Wifi, WifiOff, ShieldAlert, Save } from 'lucide-react';
import Toolbar from './editor/Toolbar';
import PresenceStack from './editor/Presence';
import SidePanel from './editor/SidePanel';
import {
  colorFor, createCursorExtension, createProvider, publishIdentity, readPresence,
} from './editor/collaboration';
import type { Presence, CollabUser } from './editor/collaboration';

type Props = {
  pageId: string;
  title: string;
  canEdit: boolean;
  canComment: boolean;
  role: string;
  ticket: string;
  user: CollabUser;
};

type Status = 'connecting' | 'live' | 'offline' | 'unauthorized';

export default function Editor({ pageId, title, canEdit, canComment, role, ticket, user }: Props) {
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [others, setOthers] = useState<Presence[]>([]);
  const [docTitle, setDocTitle] = useState(title);
  const [titleSaving, setTitleSaving] = useState(false);
  const [panel, setPanel] = useState<'comments' | 'history'>('comments');
  const [snapshotMessage, setSnapshotMessage] = useState('');
  const [historyRev, setHistoryRev] = useState(0);
  const docRef = useRef<Y.Doc | null>(null);
  // The ticket and user object are re-minted by the server on every render, so they cannot be
  // effect dependencies — a router.refresh() would tear down and rebuild the sync stack.
  const ticketRef = useRef(ticket);
  const userRef = useRef(user);

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    const ws = createProvider(pageId, doc, ticketRef.current);
    setStatus('connecting');

    const onStatus = (event: { status: string }) => {
      setStatus(previous => {
        if (previous === 'unauthorized') return previous;
        return event.status === 'connected' ? 'live' : 'offline';
      });
    };
    const onConnectionError = () => setStatus(previous => (previous === 'unauthorized' ? previous : 'offline'));
    // Permanent close (1008) means the ticket was rejected or expired; re-authentication is required.
    const onClosed = () => setStatus('unauthorized');
    const onAwarenessChange = () => {
      if (ws.awareness) setOthers(readPresence(ws.awareness, doc.clientID));
    };

    ws.on('status', onStatus);
    ws.on('connection-error', onConnectionError);
    ws.on('closed', onClosed);
    ws.awareness?.on('change', onAwarenessChange);
    if (ws.awareness) {
      publishIdentity(ws.awareness, userRef.current);
      setOthers(readPresence(ws.awareness, doc.clientID));
    }

    setProvider(ws);

    return () => {
      ws.off('status', onStatus);
      ws.off('connection-error', onConnectionError);
      ws.off('closed', onClosed);
      ws.awareness?.off('change', onAwarenessChange);
      ws.destroy();
      doc.destroy();
      docRef.current = null;
      setProvider(null);
    };
  }, [pageId]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
        Placeholder.configure({ placeholder: 'Start writing your team’s next big idea…' }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Image.configure({ allowBase64: false }),
        Highlight.configure({ multicolor: true }),
        ...(provider && provider.awareness
          ? [
              Collaboration.configure({ document: provider.doc }),
              createCursorExtension(provider.awareness),
            ]
          : []),
      ],
      editable: canEdit,
      immediatelyRender: false,
      editorProps: { attributes: { class: 'document-body' } },
    },
    [provider, canEdit],
  );

  useEffect(() => {
    editor?.setEditable(canEdit);
  }, [canEdit, editor]);

  const statusChip = useMemo(() => {    if (status === 'live') return { icon: Wifi, tone: 'text-emerald-300', label: 'Live' };
    if (status === 'connecting') return { icon: WifiOff, tone: 'text-slate-400', label: 'Connecting…' };
    if (status === 'unauthorized') return { icon: ShieldAlert, tone: 'text-rose-300', label: 'Access expired' };
    return { icon: WifiOff, tone: 'text-amber-300', label: 'Reconnecting…' };
  }, [status]);

  async function commitTitle() {
    const next = docTitle.trim();
    if (!next || next === title) {
      setDocTitle(title);
      return;
    }
    setTitleSaving(true);
    const res = await fetch(`/api/pages/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    setTitleSaving(false);
    if (!res.ok) setDocTitle(title);
  }

  async function saveSnapshot() {
    if (!editor) return;
    const res = await fetch(`/api/pages/${pageId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: editor.getJSON(), label: 'Manual snapshot' }),
    });
    setSnapshotMessage(res.ok ? 'Snapshot saved' : 'Could not save snapshot');
    if (res.ok) setHistoryRev(n => n + 1);
    window.setTimeout(() => setSnapshotMessage(''), 2500);
  }

  function restoreVersion(snapshot: unknown) {
    if (!editor) return;
    // One ProseMirror transaction that the Yjs binding replicates to every peer, so the
    // restored text lands in the shared document the same way typed edits do.
    editor.commands.setContent(snapshot as Parameters<typeof editor.commands.setContent>[0]);
    setSnapshotMessage('Version restored');
    window.setTimeout(() => setSnapshotMessage(''), 2500);
  }

  const StatusIcon = statusChip.icon;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="surface relative overflow-hidden rounded-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
          <div className="flex items-center gap-3">
            <StatusIcon size={15} className={statusChip.tone} />
            <span className={`text-xs ${statusChip.tone}`}>{statusChip.label}</span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
              {role}
            </span>
          </div>
          <PresenceStack user={user} others={others} />
        </header>

        <Toolbar editor={editor} disabled={!canEdit || !editor} />

        <div className="px-8 pt-7">
          <input
            value={docTitle}
            onChange={e => setDocTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={!canEdit}
            aria-label="Document title"
            placeholder="Untitled"
            className="w-full bg-transparent font-[Manrope] text-3xl font-extrabold tracking-tight text-white outline-none placeholder:text-slate-700 disabled:cursor-default"
          />
          {titleSaving && <p className="mt-1 text-[10px] text-slate-500">Saving title…</p>}
        </div>

        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="px-8 py-16 text-sm text-slate-600">Preparing collaborative document…</div>
        )}

        <footer className="flex items-center justify-between border-t border-white/5 px-8 py-3">
          <span className="text-xs text-slate-600">
            {canEdit ? 'Changes sync through Yjs and are saved automatically.' : 'Read-only access.'}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={saveSnapshot}
              className="flex items-center gap-2 rounded-lg bg-violet-500/15 px-3 py-2 text-xs text-violet-200 hover:bg-violet-500/25"
            >
              <Save size={14} /> Snapshot
            </button>
          )}
        </footer>
        {snapshotMessage && (
          <p className="border-t border-white/5 px-8 py-2 text-xs text-emerald-300">{snapshotMessage}</p>
        )}
      </section>

      <SidePanel
        pageId={pageId}
        panel={panel}
        setPanel={setPanel}
        canComment={canComment}
        canRestore={canEdit}
        onRestore={restoreVersion}
        refreshKey={historyRev}
        colorFor={colorFor}
      />
    </div>
  );
}
