import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decodeFrame, encodeFrame, FANOUT_MSG_AWARENESS, FANOUT_MSG_DOC } from './fanout';

describe('redis fan-out framing', () => {
  it('round-trips every byte value, which a string encoding would destroy', () => {
    const payload = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i));
    const frame = decodeFrame(encodeFrame('instance-1', { pageId: 'cmw3abc', kind: FANOUT_MSG_DOC, payload }));
    expect(frame.sender).toBe('instance-1');
    expect(frame.message.pageId).toBe('cmw3abc');
    expect(frame.message.kind).toBe(FANOUT_MSG_DOC);
    expect(Array.from(frame.message.payload)).toEqual(Array.from(payload));
  });

  it('carries a real Yjs update to another instance unchanged', () => {
    const source = new Y.Doc();
    source.getMap('probe').set('marker', 'cross-instance');
    const update = Y.encodeStateAsUpdate(source);

    const received = decodeFrame(encodeFrame('a', { pageId: 'page-1', kind: FANOUT_MSG_DOC, payload: update }));
    const target = new Y.Doc();
    Y.applyUpdate(target, received.message.payload);

    expect(target.getMap('probe').get('marker')).toBe('cross-instance');
  });

  it('keeps awareness frames separate from document frames', () => {
    const awareness = decodeFrame(encodeFrame('a', { pageId: 'p', kind: FANOUT_MSG_AWARENESS, payload: Uint8Array.from([9, 1, 2]) }));
    expect(awareness.message.kind).toBe(FANOUT_MSG_AWARENESS);
    expect(awareness.message.pageId).toBe('p');
  });
});
