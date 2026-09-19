import { describe, expect, it } from 'vitest'

import { createRouteInputSchema, reorderRoutesInputSchema } from './route'

describe('createRouteInputSchema', () => {
  const valid = { number: 1, holdCount: 40 }

  it('accepte une voie minimale (numéro + nombre de prises)', () => {
    expect(createRouteInputSchema.safeParse(valid).success).toBe(true)
  })

  it('refuse un nombre de prises nul ou négatif', () => {
    expect(createRouteInputSchema.safeParse({ ...valid, holdCount: 0 }).success).toBe(false)
  })

  it.each([
    ['javascript:alert(document.cookie)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
    ['ftp://exemple.fr/video.mp4'],
  ])('refuse un lien de vidéo qui n’est pas http(s) : %s (XSS stockée sur la page publique)', (videoUrl) => {
    expect(createRouteInputSchema.safeParse({ ...valid, videoUrl }).success).toBe(false)
  })

  it.each([['https://youtu.be/abc123'], ['http://exemple.fr/v.mp4'], ['HTTPS://Vimeo.com/1']])(
    'accepte un lien de vidéo http(s) : %s',
    (videoUrl) => {
      expect(createRouteInputSchema.safeParse({ ...valid, videoUrl }).success).toBe(true)
    },
  )

  it('refuse une URL de vidéo mal formée', () => {
    const result = createRouteInputSchema.safeParse({ ...valid, videoUrl: 'pas-une-url' })
    expect(result.success).toBe(false)
  })

  it('accepte une liste de catégories affectées', () => {
    const result = createRouteInputSchema.safeParse({
      ...valid,
      categoryIds: ['0189dcd5-5311-7d40-8db0-9496a2eef37b', '0189dcd5-5311-7d40-8db0-9496a2eef37c'],
    })
    expect(result.success).toBe(true)
  })

  it('refuse un identifiant de catégorie mal formé', () => {
    const result = createRouteInputSchema.safeParse({ ...valid, categoryIds: ['pas-un-uuid'] })
    expect(result.success).toBe(false)
  })
})

describe('reorderRoutesInputSchema', () => {
  it('refuse une liste vide', () => {
    expect(reorderRoutesInputSchema.safeParse({ orderedIds: [] }).success).toBe(false)
  })
})
