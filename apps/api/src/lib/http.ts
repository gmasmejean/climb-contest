import type { Context } from 'hono'

export function clientIp(c: Context): string | null {
  const header = c.req.header('x-forwarded-for')
  if (!header) return null
  return header.split(',')[0]?.trim() ?? null
}
