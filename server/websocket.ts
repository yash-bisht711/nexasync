import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { verifyRoomTicket } from '../src/lib/room-ticket';
import { loadRoomState, saveRoomState, pageExists, rolesForPage, closePersistence } from './persistence';
import { startFanout, publish, FANOUT_MSG_DOC, FANOUT_MSG_AWARENESS, type FanoutMessage } from './fanout';

const port = Number(process.env.WS_PORT || 1234);
const SAVE_DEBOUNCE_MS = 1500;
const IDLE_EVICT_MS = 60_000;
const ROLE_RECHECK_MS = 15_000;

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;

// Yjs transaction origin for state that arrived from another instance over Redis. It has to be a
// value no WebSocket connection can be, so the fan-out handler can tell "relay this to my clients"
// apart from "a client on this instance just made this change".
const FANOUT_ORIGIN = 'fanout';

type Conn = WebSocket & {
  roomId?: string;
  role?: string;
  userId?: string;
  clientIds?: Set<number>;
};

function canEditRole(role?: string) {
  return role === 'OWNER' || role === 'EDITOR';
}

class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Set<Conn>();
  ready: Promise<void>;
  private saveTimer: NodeJS.Timeout | null = null;
  private evictTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(readonly pageId: string) {
    this.awareness.setLocalState(null);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      const relayed = origin === FANOUT_ORIGIN;
      // Only the instance that took the edit from a client writes it to the database; the others
      // hold the same state in memory, and having every one of them upsert the full document on
      // every debounce window would multiply the writes without adding durability.
      if (!relayed) {
        this.dirty = true;
        this.scheduleSave();
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      // `origin` is the sending socket for local edits, so it is excluded from the fan-out to that
      // socket only. For relayed updates it is a string, which matches no connection, so every
      // local client in the room receives it.
      broadcast(this, encoding.toUint8Array(encoder), origin as Conn);
      if (!relayed) publish(this.pageId, FANOUT_MSG_DOC, update);
    });
    this.awareness.on('update', (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = changes.added.concat(changes.updated, changes.removed);
      if (!changed.length) return;
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      broadcast(this, encoding.toUint8Array(encoder), origin as Conn);
      if (origin !== FANOUT_ORIGIN) publish(this.pageId, FANOUT_MSG_AWARENESS, update);
    });
    this.ready = this.load();
  }

  private async load() {
    const stored = await loadRoomState(this.pageId);
    if (stored && stored.byteLength > 0) {
      Y.applyUpdate(this.doc, stored, 'load');
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(err => console.error(`Save failed for ${this.pageId}`, err));
    }, SAVE_DEBOUNCE_MS);
  }

  async flush() {
    if (!this.dirty) return;
    // A room that has not finished loading must never write: its doc is empty, and saving it
    // would silently replace the stored state with nothing.
    await this.ready;
    this.dirty = false;
    await saveRoomState(this.pageId, Y.encodeStateAsUpdate(this.doc));
  }

  add(conn: Conn) {
    this.conns.add(conn);
    conn.roomId = this.pageId;
    if (this.evictTimer) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }
  }

  remove(conn: Conn) {
    // Both 'close' and 'error' can fire for one socket, so a second removal must not arm a
    // second eviction timer — only the latest handle is cleared on rejoin.
    if (!this.conns.delete(conn)) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(conn.clientIds || []), 'client disconnected');
    if (this.conns.size === 0) {
      this.evictTimer = setTimeout(() => {
        this.evictTimer = null;
        void this.evict();
      }, IDLE_EVICT_MS);
    }
  }

  private async evict() {
    try {
      await this.flush();
    } catch (err) {
      console.error(`Evict save failed for ${this.pageId}`, err);
    }
    // A client may have rejoined while the save was in flight; the room is still registered,
    // so hand it back instead of destroying a doc that is in use.
    if (this.conns.size > 0) return;
    if (rooms.get(this.pageId) === this) rooms.delete(this.pageId);
    this.doc.destroy();
  }
}

const rooms = new Map<string, Room>();

async function getRoom(pageId: string) {
  let room = rooms.get(pageId);
  if (!room) {
    room = new Room(pageId);
    rooms.set(pageId, room);
  }
  await room.ready;
  return room;
}

function broadcast(room: Room, message: Uint8Array, except?: Conn) {
  for (const conn of room.conns) {
    if (conn !== except && conn.readyState === WebSocket.OPEN) {
      conn.send(message);
    }
  }
}

function sendSyncStep1(room: Room, conn: Conn) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  conn.send(encoding.toUint8Array(encoder));
}

function handleSync(room: Room, conn: Conn, decoder: decoding.Decoder) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  const syncType = decoding.readVarUint(decoder);
  const editable = canEditRole(conn.role);

  if (syncType === syncProtocol.messageYjsSyncStep1) {
    syncProtocol.readSyncStep1(decoder, encoder, room.doc);
  } else if (!editable) {
    // Read-only members receive document state but their mutations are never applied.
    return;
  } else if (syncType === syncProtocol.messageYjsSyncStep2) {
    syncProtocol.readSyncStep2(decoder, room.doc, conn);
  } else if (syncType === syncProtocol.messageYjsUpdate) {
    syncProtocol.readUpdate(decoder, room.doc, conn);
  } else {
    return;
  }

  if (encoding.length(encoder) > 1) {
    conn.send(encoding.toUint8Array(encoder));
  }
}

function handleAwareness(room: Room, conn: Conn, decoder: decoding.Decoder) {
  const update = decoding.readVarUint8Array(decoder);
  const known = new Set(room.awareness.states.keys());
  // The Awareness 'update' listener registered in the Room constructor relays this to the other
  // sockets on this instance and publishes it to Redis, so applying it is enough here.
  awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn);
  for (const clientId of room.awareness.states.keys()) {
    if (!known.has(clientId)) conn.clientIds?.add(clientId);
  }
}

function queryAwareness(room: Room, conn: Conn) {
  const clientIds = Array.from(room.awareness.states.keys()).filter(id => id !== room.doc.clientID);
  if (!clientIds.length) return;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, clientIds));
  conn.send(encoding.toUint8Array(encoder));
}

const wss = new WebSocketServer({ port });

// State relayed from another instance is applied only to rooms this process already holds. An
// inbound frame for a room with no local client must not resurrect an empty document, because
// nothing would ever evict it again.
function handleFanout(message: FanoutMessage) {
  const room = rooms.get(message.pageId);
  if (!room) return;
  if (message.kind === FANOUT_MSG_DOC) Y.applyUpdate(room.doc, message.payload, FANOUT_ORIGIN);
  else awarenessProtocol.applyAwarenessUpdate(room.awareness, message.payload, FANOUT_ORIGIN);
}

startFanout(handleFanout).catch(err => {
  console.error('REDIS_URL is set but Redis is unreachable. Exiting rather than running a second instance that silently ignores the first.');
  console.error(err);
  process.exit(1);
});

/**
 * A room ticket fixes the role at handshake time, so without this an OWNER who removes or demotes
 * a member would leave that member editing for as long as their socket stays open. Only rooms with
 * clients are polled, and a failed query keeps the current roles rather than revoking everyone.
 */
async function recheckRoles() {
  for (const room of rooms.values()) {
    if (room.conns.size === 0) continue;
    const userIds = Array.from(new Set(Array.from(room.conns, conn => conn.userId).filter(Boolean))) as string[];
    let roles: Map<string, string>;
    try {
      roles = await rolesForPage(room.pageId, userIds);
    } catch (err) {
      console.error(`Role re-check failed for ${room.pageId}`, err);
      continue;
    }
    for (const conn of room.conns) {
      const role = conn.userId ? roles.get(conn.userId) : undefined;
      const losingRights = role !== undefined && canEditRole(conn.role) && !canEditRole(role);
      if (!role || losingRights) {
        // 1008 keeps the client from reconnecting with the same stale ticket; it has to come back
        // through the app, which mints a ticket from the role the database holds now.
        conn.close(1008, role ? 'Editing rights revoked' : 'Access revoked');
        continue;
      }
      conn.role = role;
    }
  }
}

setInterval(() => void recheckRoles(), ROLE_RECHECK_MS);

wss.on('connection', async (socket, req) => {
  const conn = socket as Conn;
  conn.clientIds = new Set();
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pageId = decodeURIComponent(url.pathname.slice(1));
  const ticket = url.searchParams.get('ticket');

  let room: Room | null = null;
  let closedEarly = false;
  const pending: Buffer[] = [];

  const dispatch = (data: Buffer) => {
    if (!room) return;
    const decoder = decoding.createDecoder(new Uint8Array(data));
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MSG_SYNC) handleSync(room, conn, decoder);
    else if (messageType === MSG_AWARENESS) handleAwareness(room, conn, decoder);
    else if (messageType === MSG_QUERY_AWARENESS) queryAwareness(room, conn);
  };

  // Registered before the first await, not merely before the room resolves. Ticket verification
  // and the page lookup both take at least one I/O turn, and a client sends its opening SyncStep1
  // while they are still running; ws discards a frame that arrives with no 'message' listener
  // attached, and the pair then waits for a sync reply that will never come.
  conn.on('message', data => {
    if (room) dispatch(data as Buffer);
    else pending.push(data as Buffer);
  });
  conn.on('close', () => {
    closedEarly = true;
    if (room) room.remove(conn);
  });
  conn.on('error', () => {
    closedEarly = true;
    if (room) room.remove(conn);
  });

  if (!/^[a-z0-9]{10,40}$/i.test(pageId)) {
    conn.close(1008, 'Invalid room');
    return;
  }
  const payload = ticket ? await verifyRoomTicket(ticket) : null;
  if (!payload || payload.pageId !== pageId) {
    conn.close(1008, 'Unauthorized');
    return;
  }
  if (!(await pageExists(pageId))) {
    conn.close(1008, 'Unknown page');
    return;
  }

  try {
    room = await getRoom(pageId);
  } catch (err) {
    console.error(`Room ${pageId} could not be loaded`, err);
    conn.close(1011, 'Room unavailable');
    return;
  }
  if (closedEarly) return;

  conn.role = payload.role;
  conn.userId = payload.userId;
  room.add(conn);

  sendSyncStep1(room, conn);
  queryAwareness(room, conn);
  for (const queued of pending.splice(0)) dispatch(queued);
});

wss.on('listening', () => {
  console.log(`Yjs WebSocket server listening on ws://localhost:${port}`);
});

async function shutdown() {
  console.log(`Flushing ${rooms.size} room(s) before exit…`);
  await Promise.all(Array.from(rooms.values()).map(room => room.flush().catch(() => {})));
  wss.close();
  await closePersistence();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
