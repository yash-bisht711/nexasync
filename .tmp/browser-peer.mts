import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const [port, pageId, ticket, label] = process.argv.slice(2);
const doc = new Y.Doc();
const provider = new WebsocketProvider(`ws://localhost:${port}`, pageId, doc, { params: { ticket } });
const t0 = Date.now();
const log = (m: string) => console.log(`[${label}] +${Date.now() - t0}ms ${m}`);

const fragment = doc.getXmlFragment('default');
let last = fragment.toString();
fragment.observe(() => {
  const now = fragment.toString();
  if (now !== last) {
    last = now;
    log(`fragment=${JSON.stringify(now)}`);
  }
});

provider.on('sync', (synced: boolean) => {
  if (!synced) return;
  log(`synced, fragment=${JSON.stringify(fragment.toString())}`);
  provider.awareness.setLocalStateField('user', { id: `peer-${label}`, name: `Peer ${label}`, color: 'hsl(280 72% 62%)' });
  log('published presence');
});

provider.awareness.on('change', () => {
  const names = Array.from(provider.awareness.getStates().entries())
    .filter(([id]) => id !== doc.clientID)
    .map(([, s]: any) => s?.user?.name)
    .filter(Boolean);
  log(`peers=${JSON.stringify(names)}`);
});

setTimeout(() => {
  log(`exit fragment=${JSON.stringify(fragment.toString())}`);
  provider.destroy();
  doc.destroy();
  process.exit(0);
}, Number(process.env.LIFETIME || 30000));
