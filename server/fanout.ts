import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

export const FANOUT_MSG_DOC = 0;
export const FANOUT_MSG_AWARENESS = 1;
export type FanoutKind = typeof FANOUT_MSG_DOC | typeof FANOUT_MSG_AWARENESS;

const CHANNEL = 'collabspace:room-events';

// Every process gets its own id and ignores its own published frames, so an update applied from
// Redis is never bounced back onto the wire a second time.
const instanceId = randomUUID();

let publisher: Redis | null = null;

export type FanoutMessage = { pageId: string; kind: FanoutKind; payload: Uint8Array };
export type FanoutFrame = { sender: string; message: FanoutMessage };

export function encodeFrame(sender: string, message: FanoutMessage): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, sender);
  encoding.writeVarUint(encoder, message.kind);
  encoding.writeVarString(encoder, message.pageId);
  encoding.writeVarUint8Array(encoder, message.payload);
  return encoding.toUint8Array(encoder);
}

export function decodeFrame(bytes: Uint8Array): FanoutFrame {
  const decoder = decoding.createDecoder(bytes);
  const sender = decoding.readVarString(decoder);
  const kind = decoding.readVarUint(decoder) as FanoutKind;
  const pageId = decoding.readVarString(decoder);
  return { sender, message: { pageId, kind, payload: decoding.readVarUint8Array(decoder) } };
}

export async function startFanout(onMessage: (message: FanoutMessage) => void) {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('REDIS_URL is not set; running as a single instance');
    return false;
  }
  const options = { lazyConnect: true, maxRetriesPerRequest: null, enableOfflineQueue: false };
  const subscriber = new Redis(url, options);
  publisher = new Redis(url, options);
  await Promise.all([publisher.connect(), subscriber.connect()]);
  await subscriber.subscribe(CHANNEL);
  // messageBuffer, not message: ioredis runs the 'message' payload through toString(), and that
  // charset conversion destroys binary Yjs updates.
  subscriber.on('messageBuffer', (_channel: Buffer, raw: Buffer) => {
    const frame = decodeFrame(new Uint8Array(raw));
    if (frame.sender === instanceId) return;
    onMessage(frame.message);
  });
  console.log(`Redis fan-out active on ${CHANNEL} (instance ${instanceId.slice(0, 8)})`);
  return true;
}

export function publish(pageId: string, kind: FanoutKind, payload: Uint8Array) {
  if (!publisher) return;
  publisher
    .publish(CHANNEL, Buffer.from(encodeFrame(instanceId, { pageId, kind, payload })))
    .catch(err => console.error(`Fan-out publish failed for ${pageId}`, err));
}
