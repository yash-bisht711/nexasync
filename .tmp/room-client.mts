import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const BASE = 'http://localhost:3000';

if (process.argv[2] === 'mint') {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@collabspace.dev', password: 'Demo1234!' }),
  });
  const cookie = (login.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
  const { workspaces } = await (await fetch(`${BASE}/api/workspaces`, { headers: { cookie } })).json();
  const { page } = await (await fetch(`${BASE}/api/pages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ workspaceId: workspaces[0].id, title: `Fan-out ${Date.now()}`, type: 'DOC' }),
  })).json();
  const { ticket } = await (await fetch(`${BASE}/api/pages/${page.id}/ticket`, { headers: { cookie } })).json();
  console.log(`${page.id} ${ticket}`);
  process.exit(0);
}

const [port, pageId, ticket, label, action] = process.argv.slice(2);
const doc = new Y.Doc();
const provider = new WebsocketProvider(`ws://localhost:${port}`, pageId, doc, { params: { ticket } });
const t0 = Date.now();
const log = (m: string) => console.log(`[${label}] +${Date.now() - t0}ms ${m}`);

const timer = setTimeout(() => { log('TIMEOUT waiting for sync'); process.exit(2); }, 8000);
provider.on('sync', (synced: boolean) => {
  if (!synced) return;
  clearTimeout(timer);
  log('synced');
  if (action === 'write') {
    doc.getMap('probe').set('marker', `${label}-${Date.now()}`);
    log(`wrote marker ${doc.getMap('probe').get('marker')}`);
  }
  if (action === 'awareness') {
    provider.awareness.setLocalStateField('user', { name: label });
    log('published awareness');
  }
});

// Watch for whatever arrives next and report it.
const seen = setInterval(() => {
  const marker = doc.getMap('probe').get('marker');
  const names = Array.from(provider.awareness.getStates().entries())
    .map(([, s]: any) => s?.user?.name).filter(Boolean);
  if (action === 'watch' && (marker || names.length)) {
    log(`marker=${String(marker)} peers=${JSON.stringify(names)}`);
    clearInterval(seen);
    console.log('PASS');
    provider.destroy();
    doc.destroy();
    process.exit(0);
  }
}, 200);

setTimeout(() => {
  log(`end marker=${String(doc.getMap('probe').get('marker'))}`);
  provider.destroy();
  doc.destroy();
  process.exit(action === 'watch' ? 3 : 0);
}, Number(process.env.LIFETIME || 20000));
