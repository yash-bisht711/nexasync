import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { elementStore, fileStore, readElements, readFiles } from '../src/components/board/sync';

const [url, pageId, ticket] = process.argv.slice(2);
if (!url || !pageId || !ticket) {
  console.error('usage: tsx .tmp/probe-board.mts <ws-url> <pageId> <ticket>');
  process.exit(1);
}

const doc = new Y.Doc();
const ws = new WebsocketProvider(url, pageId, doc, { params: { ticket } });

ws.on('sync', (synced: boolean) => {
  if (!synced) return;
  const elements = readElements(elementStore(doc));
  console.log(
    JSON.stringify({
      clientCount: doc.clientID,
      elements: elements.length,
      ids: elements.map(e => `${e.id}@v${e.version}`).sort(),
      files: Object.keys(readFiles(fileStore(doc))).length,
      bytes: Y.encodeStateAsUpdate(doc).byteLength,
    }),
  );
  ws.destroy();
  doc.destroy();
  process.exit(0);
});

ws.on('status', (e: { status: string }) => console.error('status', e.status));
ws.on('connection-error', (e: unknown) => { console.error('connection-error', String(e)); process.exit(1); });

setTimeout(() => { console.error('sync timeout'); process.exit(1); }, 8000);
