import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { elementStore, readElements } from '../src/components/board/sync';

const [url, pageId, ticket, action] = process.argv.slice(2);

const doc = new Y.Doc();
const ws = new WebsocketProvider(url, pageId, doc, { params: { ticket } });

ws.on('sync', (synced: boolean) => {
  if (!synced) return;
  const store = elementStore(doc);
  const ids = readElements(store).map(e => e.id);

  if (action === 'copy') {
    const first = readElements(store)[0];
    if (!first) {
      console.error('source board is empty');
      process.exit(1);
    }
    writeFileSync('.tmp/element.json', JSON.stringify(first));
    console.log(JSON.stringify({ copied: first.id, bytes: JSON.stringify(first).length }));
    ws.destroy();
    doc.destroy();
    process.exit(0);
  }

  if (action === 'seed') {
    // A real element lifted off the Sprint board, so Excalidraw accepts it instead of
    // silently dropping hand-made JSON.
    const base = JSON.parse(readFileSync('.tmp/element.json', 'utf8'));
    const count = Number(process.argv[6]) || 1;
    const added: string[] = [];
    doc.transact(() => {
      for (let i = 0; i < count; i++) {
        const id = `seed${i}`;
        if (store.has(id)) continue;
        store.set(id, JSON.stringify({ ...base, id, version: 1, index: `a${i}`, x: base.x + i * 120, y: base.y + i * 40 }));
        added.push(id);
      }
    });
    console.log(JSON.stringify({ added, total: readElements(store).map(e => e.id).sort() }));
    setTimeout(() => {
      ws.destroy();
      doc.destroy();
      process.exit(0);
    }, 500);
    return;
  }

  console.log(JSON.stringify({ action, elements: ids.length, ids: ids.sort() }));
  ws.destroy();
  doc.destroy();
  process.exit(0);
});

setTimeout(() => {
  console.error('sync timeout');
  process.exit(1);
}, 8000);
