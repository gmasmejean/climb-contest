import { rateLimiter } from 'hono-rate-limiter'

import { clientIp } from '../lib/http'

/**
 * Limitation de débit en mémoire, par IP — voir TODO.md : à revoir si l'API
 * tourne un jour en plusieurs workers (cf. ADR-014, DECISIONS.md).
 */
export function authRateLimiter(limit: number, windowMs: number) {
  return rateLimiter({
    windowMs,
    limit,
    keyGenerator: (c) => clientIp(c) ?? 'unknown',
  })
}
