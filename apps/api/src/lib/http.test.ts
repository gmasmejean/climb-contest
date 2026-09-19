import type { Context } from 'hono'
import { describe, expect, it } from 'vitest'

import { clientIp } from './http'

const contextWith = (forwardedFor: string | undefined) =>
  ({ req: { header: (name: string) => (name === 'x-forwarded-for' ? forwardedFor : undefined) } }) as unknown as Context

describe('clientIp — jamais une valeur que le client peut choisir', () => {
  it('renvoie l’unique adresse ajoutée par le proxy', () => {
    expect(clientIp(contextWith('203.0.113.9'))).toBe('203.0.113.9')
  })

  it('prend la DERNIÈRE entrée : celle que NOTRE proxy a ajoutée, pas celles que le client a écrites', () => {
    expect(clientIp(contextWith('1.1.1.1, 2.2.2.2, 203.0.113.9'))).toBe('203.0.113.9')
  })

  it('une adresse forgée par le client en tête ne change pas la clé de limitation', () => {
    const real = '203.0.113.9'
    expect(clientIp(contextWith(`10.0.0.${Math.floor(Math.random() * 250)}, ${real}`))).toBe(real)
    expect(clientIp(contextWith(`evil, ${real}`))).toBe(real)
  })

  it('ignore les espaces et les entrées vides en fin de liste', () => {
    expect(clientIp(contextWith(' 1.1.1.1 ,  203.0.113.9  '))).toBe('203.0.113.9')
    expect(clientIp(contextWith('203.0.113.9,'))).toBe('203.0.113.9')
  })

  it('renvoie null sans en-tête ou avec un en-tête vide', () => {
    expect(clientIp(contextWith(undefined))).toBeNull()
    expect(clientIp(contextWith(''))).toBeNull()
    expect(clientIp(contextWith(' , '))).toBeNull()
  })
})
