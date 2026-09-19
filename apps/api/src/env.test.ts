import { describe, expect, it } from 'vitest'

import { loadEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://x',
  CORS_ORIGIN: 'http://localhost',
  PUBLIC_APP_URL: 'http://localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_JUDGE_SECRET: 'b'.repeat(32),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'a@b.fr',
}

describe('AUTH_RATE_LIMIT_MAX (piles de test uniquement)', () => {
  it('est absent par défaut : les plafonds normaux s’appliquent', () => {
    expect(loadEnv(base).AUTH_RATE_LIMIT_MAX).toBeUndefined()
  })

  it('une variable VIDE (compose sans surcharge) équivaut à absente', () => {
    expect(loadEnv({ ...base, AUTH_RATE_LIMIT_MAX: '' }).AUTH_RATE_LIMIT_MAX).toBeUndefined()
  })

  it('lit un plafond relevé', () => {
    expect(loadEnv({ ...base, AUTH_RATE_LIMIT_MAX: '1000' }).AUTH_RATE_LIMIT_MAX).toBe(1000)
  })

  it.each([['0'], ['-5'], ['abc'], ['1.5']])('refuse %s', (value) => {
    expect(() => loadEnv({ ...base, AUTH_RATE_LIMIT_MAX: value })).toThrow(/Configuration invalide/)
  })
})
