import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const BASE = 'http://localhost:3000';
const port = process.argv[2] || '1234';
const count = Number(process.argv[3] || 1);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'demo@collabspace.dev', password: 'Demo1234!' }),
});
const cookie = (login.headers.getSetCookie() ?? []).map(c => c.split(';')[0]).join('; ');
const { workspaces } = await (await fetch(`${BASE}/api/workspaces`, { headers: { cookie } })).json();
const { page } = await (await fetch(`${BASE}/api/pages`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
  body: JSON.stringify({ workspaceId: workspaces[0].id, title: `Prov ${Date.now()}`, type: 'DOC' }),
})).json();
const { ticket } = await (await fetch(`${BASE}/api/pages/${page.id}/ticket`, { headers: { cookie } })).json();
console.log('page', page.id);

const t0 = Date.now();
const log = (m: string) => console.log(`+${Date.now() - t0}ms ${m}`);

for (let i = 0; i < count; i++) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`ws://localhost:${port}`, page.id, doc, { params: { ticket } });
  provider.on('status', (e: any) => {
    log(`#${i} status=${e.status}`);
    const ws: any = (provider as any).ws;
    if (!ws || (provider as any).wrapped) return;
    (provider as any).wrapped = true;
    const rawSend = ws.send.bind(ws);
    ws.send = (data: any) => {
      const bytes = new Uint8Array(data);
      log(`#${i} -> kind=${bytes[0]} len=${bytes.length}`);
      return rawSend(data);
    };
    ws.addEventListener('message', (ev: any) => {
      const buf = Buffer.isBuffer(ev.data) ? ev.data : Buffer.from(ev.data);
      log(`#${i} <- kind=${buf[0]} len=${buf.length}`);
    });
  });
  provider.on('sync', (s: boolean) => log(`#${i} sync=${s}`));
  provider.on('connection-error', (e: any) => log(`#${i} connection-error ${e?.message || e}`));
}

setTimeout(() => { log('end'); process.exit(0); }, 8000);
