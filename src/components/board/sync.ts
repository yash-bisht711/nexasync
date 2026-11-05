import * as Y from 'yjs';

/**
 * Only the fields the bridge itself needs. Excalidraw element objects carry many more
 * properties, and they are preserved verbatim because each element is stored as its own
 * JSON value.
 */
export type BoardElement = {
  id: string;
  version: number;
  index?: string;
  isDeleted?: boolean;
};

export type BoardFile = {
  mimeType: string;
  lastModified?: number;
};

export const ELEMENTS_KEY = 'excalidraw:elements';
export const FILES_KEY = 'excalidraw:files';

export function elementStore(doc: Y.Doc) {
  return doc.getMap<string>(ELEMENTS_KEY);
}

export function fileStore(doc: Y.Doc) {
  return doc.getMap<string>(FILES_KEY);
}

function parse(raw: string | undefined): BoardElement | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BoardElement;
  } catch {
    return null;
  }
}

/**
 * Pushes the local scene into the shared document. `synced` remembers the last version written
 * per element so repeated onChange fires are cheap and idempotent. `seen` is the set of ids this
 * client has actually rendered in its own scene, and is the only basis for deletions.
 */
export function writeElements(
  store: Y.Map<string>,
  elements: readonly BoardElement[],
  synced: Map<string, number>,
  seen: Set<string>,
) {
  const ids = new Set<string>();
  let changed = 0;

  for (const element of elements) {
    ids.add(element.id);
    if (synced.get(element.id) === element.version) continue;
    store.set(element.id, JSON.stringify(element));
    synced.set(element.id, element.version);
    changed++;
  }

  // A scene that has not caught up with the shared document — a fresh mount, or a peer stroke
  // still in flight — must not be read as a deletion, or it erases content it never rendered.
  for (const id of Array.from(seen)) {
    if (ids.has(id)) continue;
    store.delete(id);
    synced.delete(id);
    changed++;
  }

  seen.clear();
  for (const id of ids) seen.add(id);

  return changed;
}

/**
 * Element-level granularity is deliberate: Excalidraw replaces whole element objects per
 * version, and concurrent strokes always have different ids, so they merge without conflict.
 */
export function readElements(store: Y.Map<string>): BoardElement[] {
  const out: BoardElement[] = [];
  store.forEach(raw => {
    const element = parse(raw);
    if (element && !element.isDeleted) out.push(element);
  });
  return out.sort(compareIndex);
}

function compareIndex(a: BoardElement, b: BoardElement) {
  const left = a.index ?? '';
  const right = b.index ?? '';
  if (left === right) return a.id < b.id ? -1 : 1;
  return left < right ? -1 : 1;
}

export function writeFiles(
  store: Y.Map<string>,
  files: Record<string, BoardFile>,
  synced: Map<string, number>,
) {
  let changed = 0;
  for (const [id, file] of Object.entries(files)) {
    const stamp = file.lastModified ?? 0;
    if (synced.get(id) === stamp) continue;
    store.set(id, JSON.stringify(file));
    synced.set(id, stamp);
    changed++;
  }
  return changed;
}

export function readFiles(store: Y.Map<string>): Record<string, BoardFile> {
  const out: Record<string, BoardFile> = {};
  store.forEach((raw, id) => {
    const file = parse(raw) as BoardFile | null;
    if (file) out[id] = file;
  });
  return out;
}

export type BoardSnapshot = {
  kind: 'board';
  elements: BoardElement[];
  files: Record<string, BoardFile>;
};

const RESTORE_ORIGIN = 'board-restore';

export function snapshotBoard(doc: Y.Doc): BoardSnapshot {
  return { kind: 'board', elements: readElements(elementStore(doc)), files: readFiles(fileStore(doc)) };
}

/** Documents store a ProseMirror JSON tree, so the `kind` marker is what tells the two apart. */
export function isBoardSnapshot(value: unknown): value is BoardSnapshot {
  const candidate = value as Partial<BoardSnapshot> | null;
  return Boolean(candidate && candidate.kind === 'board' && Array.isArray(candidate.elements));
}

/**
 * Replaces the shared scene with a stored snapshot. The clear and the rewrite happen in one
 * transaction, so peers observe the finished board rather than an empty canvas in between.
 */
export function applyBoardSnapshot(doc: Y.Doc, snapshot: BoardSnapshot) {
  const elements = elementStore(doc);
  const files = fileStore(doc);
  doc.transact(() => {
    elements.clear();
    for (const element of snapshot.elements) {
      // Excalidraw keeps the copy it already has whenever an incoming version is not newer, so a
      // restore that reused the stored version rendered nothing. Bumping makes the snapshot look
      // like a fresh edit to every connected canvas, including the one that triggered it.
      const restored = { ...element, version: element.version + 1 };
      elements.set(restored.id, JSON.stringify(restored));
    }
    files.clear();
    for (const [id, file] of Object.entries(snapshot.files)) files.set(id, JSON.stringify(file));
  }, RESTORE_ORIGIN);
}
