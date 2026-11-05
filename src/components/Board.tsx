'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { Wifi, WifiOff, ShieldAlert, Save } from 'lucide-react';
import PresenceStack from './editor/Presence';
import SidePanel from './editor/SidePanel';
import { applyBoardSnapshot, isBoardSnapshot, snapshotBoard } from './board/sync';
import {
  colorFor, createProvider, publishIdentity, readPresence,
} from './editor/collaboration';
import type { Presence, CollabUser } from './editor/collaboration';

const BoardCanvas = dynamic(() => import('./board/BoardCanvas'), {
  ssr: false,
  loading: () => <div className="py-16 text-center text-sm text-slate-500">Loading canvas…</div>,
});

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

export default function Board({ pageId, title, canEdit, canComment, role, ticket, user }: Props) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<WebsocketProvider['awareness'] | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [synced, setSynced] = useState(false);
  const [others, setOthers] = useState<Presence[]>([]);
  const [docTitle, setDocTitle] = useState(title);
  const [titleSaving, setTitleSaving] = useState(false);
  const [panel, setPanel] = useState<'comments' | 'history'>('comments');
  const [snapshotMessage, setSnapshotMessage] = useState('');
  const [historyRev, setHistoryRev] = useState(0);
  // Re-minted by the server on every render, so they cannot be effect dependencies —
  // a router.refresh() would tear the room down mid-sync.
  const ticketRef = useRef(ticket);
  const userRef = useRef(user);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ws = createProvider(pageId, ydoc, ticketRef.current);
    setStatus('connecting');
    setSynced(false);

    const onStatus = (event: { status: string }) => {
      setStatus(previous => {
        if (previous === 'unauthorized') return previous;
        return event.status === 'connected' ? 'live' : 'offline';
      });
    };
    const onConnectionError = () => setStatus(previous => (previous === 'unauthorized' ? previous : 'offline'));
    const onClosed = () => setStatus('unauthorized');
    // Sticky on purpose: y-websocket sets synced=false whenever a socket drops, and remounting
    // Excalidraw on every reconnect threw away the live scene. Once the first server state has
    // landed the local document is safe to read from and write to, blips included.
    const onSync = (state: boolean) => {
      if (state) setSynced(true);
    };
    const onAwarenessChange = () => {
      if (ws.awareness) setOthers(readPresence(ws.awareness, ydoc.clientID));
    };

    ws.on('status', onStatus);
    ws.on('connection-error', onConnectionError);
    ws.on('closed', onClosed);
    ws.on('sync', onSync);
    ws.awareness?.on('change', onAwarenessChange);
    if (ws.awareness) {
      publishIdentity(ws.awareness, userRef.current);
      setOthers(readPresence(ws.awareness, ydoc.clientID));
    }

    setDoc(ydoc);
    setAwareness(ws.awareness ?? null);

    return () => {
      ws.off('status', onStatus);
      ws.off('connection-error', onConnectionError);
      ws.off('closed', onClosed);
      ws.off('sync', onSync);
      ws.awareness?.off('change', onAwarenessChange);
      ws.destroy();
      ydoc.destroy();
      setDoc(null);
      setAwareness(null);
    };
  }, [pageId]);

  const statusChip = useMemo(() => {
    if (status === 'live') return { icon: Wifi, tone: 'text-emerald-300', label: 'Live' };
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
    if (!doc) return;
    const res = await fetch(`/api/pages/${pageId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot: snapshotBoard(doc), label: 'Board snapshot' }),
    });
    setSnapshotMessage(res.ok ? 'Snapshot saved' : 'Could not save snapshot');
    if (res.ok) setHistoryRev(n => n + 1);
    window.setTimeout(() => setSnapshotMessage(''), 2500);
  }

  function restoreVersion(snapshot: unknown) {
    if (!doc || !isBoardSnapshot(snapshot)) {
      setSnapshotMessage('That snapshot is not a board');
      window.setTimeout(() => setSnapshotMessage(''), 2500);
      return;
    }
    applyBoardSnapshot(doc, snapshot);
    setSnapshotMessage('Board restored');
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
            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
              Board
            </span>
          </div>
          <PresenceStack user={user} others={others} />
        </header>

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
            aria-label="Board title"
            placeholder="Untitled board"
            className="w-full bg-transparent font-[Manrope] text-3xl font-extrabold tracking-tight text-white outline-none placeholder:text-slate-700 disabled:cursor-default"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            {canEdit ? 'Pencil, eraser and colours sync live through the same Yjs room.' : 'Read-only board.'}
          </p>
        </div>

        {doc && synced ? (
          <BoardCanvas
            doc={doc}
            awareness={awareness}
            selfClientId={doc.clientID}
            canEdit={canEdit}
            synced={synced}
          />
        ) : (
          <div className="py-16 text-sm text-slate-600">Connecting to the board…</div>
        )}

        <footer className="flex items-center justify-between border-t border-white/5 px-8 py-3">
          <span className="text-xs text-slate-600">
            {canEdit ? 'Elements sync through Yjs and are saved automatically.' : 'Read-only access.'}
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
