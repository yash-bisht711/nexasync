import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

const BASE = 'http://localhost:3000';
const port = process.argv[2] || '1234';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@collabspace.dev', password: 'Demo1234!' }),
});
const cookie = (login.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
const wsRes = await fetch(`${BASE}/api/workspaces`, { headers: { cookie } });
const { workspaces } = await wsRes.json();
const created = await fetch(`${BASE}/api/pages`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ workspaceId: workspaces[0].id, title: `Diag ${Date.now()}`, type: 'DOC' }),
});
const { page } = await created.json();
const tk = await fetch(`${BASE}/api/pages/${page.id}/ticket`, { headers: { cookie } });
const { ticket } = await tk.json();
console.log('page', page.id, 'ticket length', ticket.length);

const doc = new Y.Doc();
const socket = new WebSocket(`ws://localhost:${port}/${encodeURIComponent(page.id)}?ticket=${ticket}`);
const t0 = Date.now();
const log = (m: string) => console.log(`+${Date.now() - t0}ms ${m}`);

socket.on('open', () => {
  log('open');
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, doc);
  socket.send(encoding.toUint8Array(encoder));
  log('sent SyncStep1');
  if (process.argv[3] === 'awareness') {
    const aw = encoding.createEncoder();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalStateField('user', { name: 'diag' });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    encoding.writeVarUint(aw, 1);
    encoding.writeVarUint8Array(aw, update);
    socket.send(encoding.toUint8Array(aw));
    log('sent a real awareness frame');
  }
});
socket.on('message', (data: Buffer) => {
  const decoder = decoding.createDecoder(new Uint8Array(data));
  const type = decoding.readVarUint(decoder);
  log(`message kind=${type} bytes=${data.byteLength}`);
  if (type === 0) {
    const syncType = decoding.readVarUint(decoder);
    log(`  sync sub-type=${syncType}`);
  }
});
socket.on('close', (code, reason) => log(`close ${code} ${reason.toString()}`));
socket.on('error', err => log(`error ${err.message}`));
setTimeout(() => { log('done'); socket.close(); process.exit(0); }, 6000);
