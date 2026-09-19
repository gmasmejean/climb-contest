import type { Context } from 'hono'

/**
 * L'adresse du client, telle que NOTRE proxy (Caddy) l'a vue.
 *
 * On lit la DERNIÈRE entrée de `X-Forwarded-For`, jamais la première : un
 * client peut écrire n'importe quoi dans cet en-tête, et tout ce qu'il écrit
 * se retrouve AVANT l'entrée ajoutée par le proxy. Prendre la première
 * permettait de contourner la limitation de débit en changeant d'« adresse »
 * à chaque requête (revue de sécurité, Lot 9).
 *
 * Suppose UN seul proxy de confiance devant l'API (le Caddy du
 * `docker-compose.yml`). Derrière un second proxy (CDN…), la dernière entrée
 * serait celle du CDN — voir `docs/EXPLOITATION.md`.
 */
export function clientIp(c: Context): string | null {
  const header = c.req.header('x-forwarded-for')
  if (!header) return null
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return entries.at(-1) ?? null
}
