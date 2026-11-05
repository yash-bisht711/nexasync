import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const BASE = 'http://localhost:3000';
const OWNER = { email: 'demo@collabspace.dev', password: 'Demo1234!' };
const MEMBER = { email: 'revoketest@collabspace.dev', password: 'Revoke1234!' };

const problems: string[] = [];

async function signIn(creds: { email: string; password: string }) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
  });
  if (res.status === 401) {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Revoke Tester', ...creds }),
    });
    if (!reg.ok && reg.status !== 400 && reg.status !== 409) throw new Error(`register ${reg.status}`);
    return signIn(creds);
  }
  if (!res.ok) throw new Error(`login ${res.status} for ${creds.email}`);
  return (res.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
}

async function call(cookie: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', cookie, ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

type Session = { doc: Y.Doc; provider: WebsocketProvider; label: string };

function connect(port: string, pageId: string, ticket: string, label: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}`, pageId, doc, {
    params: { ticket }, shouldReconnect: (e: any) => e.code !== 1008,
  });
  const session: Session = { doc, provider, label };
  const opened = new Promise<Session>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} never synced`)), 10_000);
    provider.on('sync', (s: boolean) => { if (s) { clearTimeout(timer); resolve(session); } });
  });
  const closed = new Promise<{ code: number; reason: string }>(resolve => {
    let hooked = false;
    provider.on('status', () => {
      const ws: any = (provider as any).ws;
      if (hooked || !ws) return;
      hooked = true;
      ws.addEventListener('close', (event: any) => resolve({ code: event.code, reason: event.reason }));
    });
  });
  return { session, opened, closed };
}

async function main() {
  const owner = await signIn(OWNER);
  const member = await signIn(MEMBER);
  const { json: ws } = await call(owner, '/api/workspaces');
  const workspaceId = ws.workspaces[0].id;

  // Make sure the tester is an EDITOR of the owner's workspace, then work through one of its pages.
  const list = await call(owner, `/api/workspaces/${workspaceId}/members`);
  const existing = list.json.members?.find((m: any) => m.user.email === MEMBER.email);
  if (!existing) {
    const invited = await call(owner, `/api/workspaces/${workspaceId}/members`, {
      method: 'POST', body: JSON.stringify({ email: MEMBER.email, role: 'EDITOR' }),
    });
    if (invited.status !== 201) throw new Error(`invite failed ${invited.status}`);
  } else if (existing.role !== 'EDITOR') {
    await call(owner, `/api/workspaces/${workspaceId}/members/${existing.id}`, {
      method: 'PATCH', body: JSON.stringify({ role: 'EDITOR' }),
    });
  }

  const { json: created } = await call(owner, '/api/pages', {
    method: 'POST', body: JSON.stringify({ workspaceId, title: `Revocation ${Date.now()}`, type: 'DOC' }),
  });
  const pageId = created.page.id as string;
  console.log(`page ${pageId}`);

  const { json: membershipAfter } = await call(owner, `/api/workspaces/${workspaceId}/members`);
  const membershipId = membershipAfter.members.find((m: any) => m.user.email === MEMBER.email).id as string;

  const watcher = connect('1235', pageId, (await call(owner, `/api/pages/${pageId}/ticket`)).json.ticket, 'watcher');
  await watcher.opened;

  // ---- A: removing a live member must drop their socket ----
  const peerA = connect('1234', pageId, (await call(member, `/api/pages/${pageId}/ticket`)).json.ticket, 'peer-A');
  const sessionA = await peerA.opened;
  console.log(`peer-A role from ticket: ${(await call(member, `/api/pages/${pageId}/ticket`)).json.role}`);
  sessionA.doc.getMap('probe').set('marker', 'A-live');
  const seenByWatcher = await Promise.race([
    new Promise<string>(resolve => {
      const check = setInterval(() => {
        if (watcher.session.doc.getMap('probe').get('marker') === 'A-live') { clearInterval(check); resolve('landed'); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve('never landed'); }, 5000);
    }),
    new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 5000)),
  ]);
  console.log(`peer-A edit across instances: ${seenByWatcher}`);
  if (seenByWatcher !== 'landed') problems.push('the live editor’s edit never reached the other instance');

  const removed = await call(owner, `/api/workspaces/${workspaceId}/members/${membershipId}`, { method: 'DELETE' });
  console.log(`membership deleted: HTTP ${removed.status}`);
  const closeA = await Promise.race([peerA.closed, new Promise(r => setTimeout(() => r({ code: -1, reason: 'still connected after 25s' }), 25_000))]) as { code: number; reason: string };
  console.log(`peer-A socket closed with ${closeA.code} "${closeA.reason}"`);
  if (closeA.code !== 1008 || !/Access revoked/.test(closeA.reason)) problems.push('a removed member kept their live connection');

  // ---- B: demoting a live editor must take the write path away ----
  const reinvited = await call(owner, `/api/workspaces/${workspaceId}/members`, {
    method: 'POST', body: JSON.stringify({ email: MEMBER.email, role: 'EDITOR' }),
  });
  const demoteId = reinvited.json.membership?.id as string;
  const peerB = connect('1234', pageId, (await call(member, `/api/pages/${pageId}/ticket`)).json.ticket, 'peer-B');
  const sessionB = await peerB.opened;
  sessionB.doc.getMap('probe').set('marker', 'B-live');
  await new Promise(r => setTimeout(r, 400));
  if (watcher.session.doc.getMap('probe').get('marker') !== 'B-live') problems.push('the demoted editor’s first edit never propagated');

  const demoted = await call(owner, `/api/workspaces/${workspaceId}/members/${demoteId}`, {
    method: 'PATCH', body: JSON.stringify({ role: 'VIEWER' }),
  });
  console.log(`demoted to VIEWER: HTTP ${demoted.status}`);
  const closeB = await Promise.race([peerB.closed, new Promise(r => setTimeout(() => r({ code: -1, reason: 'still connected after 25s' }), 25_000))]) as { code: number; reason: string };
  console.log(`peer-B socket closed with ${closeB.code} "${closeB.reason}"`);
  if (closeB.code !== 1008 || !/Editing rights revoked/.test(closeB.reason)) problems.push('a demoted editor kept a writable connection');

  await call(owner, `/api/workspaces/${workspaceId}/members/${demoteId}`, { method: 'DELETE' });
  watcher.session.provider.destroy();
  watcher.session.doc.destroy();

  if (problems.length) { console.log(`FAIL: ${problems.join(' | ')}`); process.exit(1); }
  console.log('PASS: live connections lost access when membership changed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
