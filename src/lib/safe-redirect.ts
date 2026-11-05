const UNSAFE_PREFIX = /^[/\\]/;

// Only same-origin absolute paths are accepted, so a signed-out visitor cannot be
// bounced to an external site by hand-editing ?next=.
export function safeNext(value: string | null | undefined, fallback = '/app') {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (UNSAFE_PREFIX.test(value.slice(1))) return fallback;
  return value;
}
