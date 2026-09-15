/**
 * Per-instance fixed-window limiter — a first line of defence only.
 * Production must also rate-limit at the edge (WAF) because instances do not share this memory.
 * Login brute-force protection is database-backed (see auth/service.ts) and works across instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}
