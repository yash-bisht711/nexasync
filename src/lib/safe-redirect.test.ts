import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-redirect';

describe('safeNext', () => {
  it('returns internal paths unchanged', () => {
    expect(safeNext('/app/pages/abc123')).toBe('/app/pages/abc123');
  });

  it('falls back when no destination was captured', () => {
    expect(safeNext(null)).toBe('/app');
    expect(safeNext('')).toBe('/app');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeNext('https://evil.example')).toBe('/app');
    expect(safeNext('//evil.example')).toBe('/app');
    expect(safeNext('/\\evil.example')).toBe('/app');
  });
});
