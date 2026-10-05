// In-memory sliding-window counters. Enough for a single server process;
// counters reset on restart and are not shared between instances.

const globalForLimits = globalThis as unknown as {
  __rateLimitHits?: Map<string, number[]>;
};
const hits = (globalForLimits.__rateLimitHits ??= new Map<string, number[]>());

function recent(key: string, windowMs: number, now: number): number[] {
  const kept = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (kept.length) hits.set(key, kept);
  else hits.delete(key);
  return kept;
}

// True when `key` has already used its allowance for the window.
export function isRateLimited(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  return recent(key, windowMs, now).length >= limit;
}

export function recordHit(
  key: string,
  windowMs: number,
  now: number = Date.now(),
): void {
  hits.set(key, [...recent(key, windowMs, now), now]);
}

export function clearHits(key: string): void {
  hits.delete(key);
}
