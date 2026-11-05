import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyBoardSnapshot, elementStore, fileStore, isBoardSnapshot, readElements, readFiles,
  snapshotBoard, writeElements, writeFiles,
} from './sync';
import type { BoardElement } from './sync';

function element(
  id: string,
  version: number,
  extra: Partial<BoardElement> = {},
): BoardElement & Record<string, unknown> {
  return { id, type: 'draw', version, x: 0, y: 0, points: [[0, 0]], ...extra };
}

// Two docs kept in sync the way two browsers would be over the WebSocket server.
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  });
  return {
    a,
    b,
    syncedA: new Map<string, number>(),
    syncedB: new Map<string, number>(),
    seenA: new Set<string>(),
    seenB: new Set<string>(),
  };
}

describe('board sync bridge', () => {
  it('round-trips elements through the shared document', () => {
    const doc = new Y.Doc();
    const store = elementStore(doc);

    writeElements(store, [element('a', 1), element('b', 3)], new Map(), new Set());
    expect(readElements(store).map(e => e.id)).toEqual(['a', 'b']);
  });

  it('keeps concurrent strokes from two clients', () => {
    const { a, b, syncedA, syncedB, seenA, seenB } = pair();
    const storeA = elementStore(a);
    const storeB = elementStore(b);

    writeElements(storeA, [element('mine', 1)], syncedA, seenA);
    writeElements(storeB, [element('theirs', 1)], syncedB, seenB);

    expect(readElements(storeA).map(e => e.id).sort()).toEqual(['mine', 'theirs']);
    expect(readElements(storeB).map(e => e.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('does not rewrite an element whose version already matches', () => {
    const doc = new Y.Doc();
    const store = elementStore(doc);
    const synced = new Map<string, number>();
    const seen = new Set<string>();

    expect(writeElements(store, [element('a', 7)], synced, seen)).toBe(1);
    expect(writeElements(store, [element('a', 7)], synced, seen)).toBe(0);
    expect(writeElements(store, [element('a', 8)], synced, seen)).toBe(1);
  });

  it('drops an element the local scene no longer contains', () => {
    const doc = new Y.Doc();
    const store = elementStore(doc);
    const synced = new Map<string, number>();
    const seen = new Set<string>();

    writeElements(store, [element('a', 1), element('b', 1)], synced, seen);
    writeElements(store, [element('a', 1)], synced, seen);
    expect(readElements(store).map(e => e.id)).toEqual(['a']);
  });

  it('keeps remote content when the local scene has not rendered it yet', () => {
    const { a, b, syncedB, seenB, syncedA, seenA } = pair();
    const storeA = elementStore(a);

    writeElements(elementStore(b), [element('x', 1), element('y', 1)], syncedB, seenB);

    // A fresh mount reports an empty scene before updateScene has landed. Treating that as a
    // deletion is how one client used to wipe everything a peer had drawn.
    expect(writeElements(storeA, [], syncedA, seenA)).toBe(0);
    expect(readElements(storeA).map(e => e.id).sort()).toEqual(['x', 'y']);

    // Once the client has rendered them, removing one is a real edit and does propagate.
    writeElements(storeA, [element('x', 1)], syncedA, seenA);
    writeElements(storeA, [], syncedA, seenA);
    expect(readElements(elementStore(b)).map(e => e.id)).toEqual(['y']);
  });

  it('hides tombstoned elements but keeps the key so peers hide it too', () => {
    const doc = new Y.Doc();
    const store = elementStore(doc);

    writeElements(store, [element('a', 1, { isDeleted: true })], new Map(), new Set());
    expect(readElements(store)).toHaveLength(0);
    expect(store.has('a')).toBe(true);
  });

  it('orders by Excalidraw fractional index rather than arrival order', () => {
    const doc = new Y.Doc();
    const store = elementStore(doc);

    writeElements(store, [
      element('late', 1, { index: 'a1' }),
      element('first', 1, { index: 'a0' }),
    ], new Map(), new Set());
    expect(readElements(store).map(e => e.id)).toEqual(['first', 'late']);
  });

  it('survives encode/decode so the server can persist it as binary', () => {
    const { a, syncedA, seenA } = pair();
    writeElements(elementStore(a), [element('a', 1)], syncedA, seenA);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(a));
    expect(readElements(elementStore(restored)).map(e => e.id)).toEqual(['a']);
  });

  it('restores a snapshot over a scene that has moved on', () => {
    const { a, b, syncedA, seenA } = pair();

    writeElements(elementStore(a), [element('keep', 1)], syncedA, seenA);
    const snapshot = snapshotBoard(a);

    writeElements(elementStore(a), [element('keep', 2), element('new', 1)], syncedA, seenA);
    expect(readElements(elementStore(b)).map(e => e.id).sort()).toEqual(['keep', 'new']);

    applyBoardSnapshot(a, snapshot);
    expect(readElements(elementStore(b)).map(e => e.id)).toEqual(['keep']);
    // Restored elements must carry a version newer than the one canvases already hold,
    // otherwise Excalidraw discards them as stale on updateScene.
    expect(readElements(elementStore(b))[0].version).toBe(2);
  });

  it('restores image files alongside elements', () => {
    const doc = new Y.Doc();
    writeFiles(fileStore(doc), { 'f1': { mimeType: 'image/png', lastModified: 5, dataURL: 'data:image/png;base64,AA' } } as never, new Map());

    const snapshot = snapshotBoard(doc);
    writeFiles(fileStore(doc), {}, new Map());
    fileStore(doc).delete('f1');
    expect(Object.keys(readFiles(fileStore(doc)))).toEqual([]);

    applyBoardSnapshot(doc, snapshot);
    expect(readFiles(fileStore(doc)).f1.mimeType).toBe('image/png');
  });

  it('publishes the restored board in a single transaction', () => {
    const doc = new Y.Doc();
    writeElements(elementStore(doc), [element('a', 1), element('b', 1)], new Map(), new Set());
    const snapshot = snapshotBoard(doc);
    elementStore(doc).set('c', JSON.stringify(element('c', 1)));

    const sizes: number[] = [];
    elementStore(doc).observe(event => sizes.push(event.changes.keys.size));
    applyBoardSnapshot(doc, snapshot);

    // Three keys touched at once: c removed, a and b rewritten. An observer never sees an empty store.
    expect(sizes).toEqual([3]);
  });

  it('tells a board snapshot apart from a document snapshot', () => {
    expect(isBoardSnapshot({ kind: 'board', elements: [], files: {} })).toBe(true);
    expect(isBoardSnapshot({ type: 'doc', content: [] })).toBe(false);
    expect(isBoardSnapshot(null)).toBe(false);
  });
});
