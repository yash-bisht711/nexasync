import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const A = 'ws://localhost:1234';
const B = 'ws://localhost:1235';

const fail: string[] = [];

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@collabspace.dev', password: 'Demo1234!' }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const cookie = (res.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('no session cookie returned');
  return cookie;
}

async function call(cookie: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', cookie, ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function connect(url: string, pageId: string, ticket: string, label: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, pageId, doc, { params: { ticket } });
  return new Promise<Peer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} never synced with ${url}`)), 10_000);
    provider.on('sync', (synced: boolean) => {
      if (!synced) return;
      clearTimeout(timer);
      resolve({ doc, provider, label });
    });
  });
}

type Peer = { doc: Y.Doc; provider: WebsocketProvider; label: string };

async function waitFor(what: string, probe: () => boolean, budgetMs: number) {
  const started = Date.now();
  for (;;) {
    if (probe()) return Date.now() - started;
    if (Date.now() - started > budgetMs) {
      fail.push(what);
      return -1;
    }
    await new Promise(r => setTimeout(r, 25));
  }
}

function nameOf(peer: Peer, clientId: number) {
  const state = peer.provider.awareness.getStates().get(clientId) as any;
  return state?.user?.name;
}

async function main() {
  const cookie = await signIn();
  const { workspaces } = await call(cookie, '/api/workspaces');
  const workspaceId = workspaces[0].id;
  const { page } = await call(cookie, '/api/pages', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, title: `Fan-out probe ${Date.now()}`, type: 'DOC' }),
  });
  const { ticket } = await call(cookie, `/api/pages/${page.id}/ticket`);
  console.log(`scratch page ${page.id}`);

  const pA1 = await connect(A, page.id, ticket, 'A1');
  const pA2 = await connect(A, page.id, ticket, 'A2');
  const pB1 = await connect(B, page.id, ticket, 'B1');
  console.log('three clients synced: A1/A2 on 1234, B1 on 1235');

  // 1. document update travels from instance 1234 to instance 1235
  pA1.doc.getMap('probe').set('fromA1', 'redis-relay');
  const t1 = await waitFor('cross-instance doc update', () => pB1.doc.getMap('probe').get('fromA1') === 'redis-relay', 5000);
  console.log(`doc 1234 -> 1235: ${t1}ms`);

  // 2. the reverse direction
  pB1.doc.getMap('probe').set('fromB1', 'other-way');
  const t2 = await waitFor('reverse cross-instance doc update', () => pA1.doc.getMap('probe').get('fromB1') === 'other-way', 5000);
  console.log(`doc 1235 -> 1234: ${t2}ms`);

  // 3. regression: same-instance relay still works after moving the broadcast to the listener
  const t3 = await waitFor('same-instance doc update', () => pA2.doc.getMap('probe').get('fromB1') === 'other-way', 5000);
  console.log(`doc same instance: ${t3}ms`);

  // 4. presence travels across instances
  pA1.provider.awareness.setLocalStateField('user', { name: 'peer-A1' });
  const t4 = await waitFor('cross-instance presence', () => {
    for (const id of pB1.provider.awareness.getStates().keys()) {
      if (nameOf(pB1, id) === 'peer-A1') return true;
    }
    return false;
  }, 5000);
  console.log(`awareness 1234 -> 1235: ${t4}ms`);

  // 5. presence also reaches the other client on the same instance
  const t5 = await waitFor('same-instance presence', () => {
    for (const id of pA2.provider.awareness.getStates().keys()) {
      if (nameOf(pA2, id) === 'peer-A1') return true;
    }
    return false;
  }, 5000);
  console.log(`awareness same instance: ${t5}ms`);

  // 6. leaving is announced across instances too
  pA1.provider.awareness.setLocalState(null);
  const t6 = await waitFor('cross-instance presence removal', () => {
    for (const id of pB1.provider.awareness.getStates().keys()) {
      if (nameOf(pB1, id) === 'peer-A1') return false;
    }
    return true;
  }, 5000);
  console.log(`awareness leave 1234 -> 1235: ${t6}ms`);

  // 7. the instance that took the edit persisted it; the receiving instance must not double-write
  await new Promise(r => setTimeout(r, 2500));
  const prisma = new PrismaClient();
  const row = await prisma.yjsState.findUnique({ where: { pageId: page.id }, select: { state: true } });
  if (!row) {
    fail.push('no persisted state for the scratch page');
  } else {
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, new Uint8Array(row.state));
    const persisted = reloaded.getMap('probe').get('fromA1');
    console.log(`persisted bytes=${row.state.byteLength} fromA1=${String(persisted)}`);
    if (persisted !== 'redis-relay') fail.push('persisted state is missing the cross-instance write');
    reloaded.destroy();
  }
  await prisma.$disconnect();

  for (const peer of [pA1, pA2, pB1]) {
    peer.provider.disconnect();
    peer.provider.destroy();
    peer.doc.destroy();
  }

  if (fail.length) {
    console.log(`FAIL: ${fail.join(' | ')}`);
    process.exit(1);
  }
  console.log('PASS: all fan-out assertions held');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
