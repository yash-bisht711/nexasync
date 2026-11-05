'use client';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Extension } from '@tiptap/core';
import { yCursorPlugin } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';

export type CollabUser = { id: string; name: string };

export function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${hash} 72% 62%)`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function createProvider(pageId: string, doc: Y.Doc, ticket: string): WebsocketProvider {
  const url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:1234';
  return new WebsocketProvider(url, pageId, doc, {
    params: { ticket },
    // 1008 means the server rejected the ticket or the page; reconnecting would loop forever.
    shouldReconnect: event => event.code !== 1008,
  });
}

export function publishIdentity(awareness: Awareness, user: CollabUser) {
  awareness.setLocalStateField('user', { id: user.id, name: user.name, color: colorFor(user.id) });
}

export type Presence = { clientId: number; name: string; color: string; userId: string };

export function readPresence(awareness: Awareness, selfClientId: number): Presence[] {
  const seen = new Map<string, Presence>();
  for (const [clientId, state] of awareness.states) {
    if (clientId === selfClientId) continue;
    const user = (state as { user?: { id?: string; name?: string; color?: string } } | undefined)?.user;
    if (!user?.name) continue;
    const key = user.id || user.name;
    if (!seen.has(key)) {
      seen.set(key, { clientId, name: user.name, color: user.color || colorFor(key), userId: key });
    }
  }
  return Array.from(seen.values());
}

/**
 * TipTap v3 ships no collaboration-cursor extension, so the y-tiptap ProseMirror plugin
 * is registered directly. Remote cursors read their identity from awareness state.
 */
export function createCursorExtension(awareness: Awareness) {
  return Extension.create({
    name: 'collaborationCursor',
    addProseMirrorPlugins() {
      return [
        yCursorPlugin(awareness, {
          cursorBuilder: (user, clientId) => {
            const cursor = document.createElement('span');
            cursor.className = 'collab-cursor';
            cursor.dataset.clientId = String(clientId);
            const label = document.createElement('span');
            label.className = 'collab-cursor__label';
            label.textContent = user.name;
            label.style.setProperty('--collab-color', user.color);
            cursor.appendChild(label);
            return cursor;
          },
          selectionBuilder: user => ({
            class: 'collab-selection',
            style: `background-color:${user.color}33`,
          }),
        }),
      ];
    },
  });
}
