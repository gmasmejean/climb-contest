import { describe, expect, it } from 'vitest'

import {
  ROUTE_PHOTO_MAX_HOLDS,
  addHold,
  changeHoldNumber,
  moveHold,
  nextHoldNumber,
  removeHold,
  renumberByHeight,
  routePhotoHoldsInputSchema,
  type RouteHold,
} from './route-photo'

describe('routePhotoHoldsInputSchema', () => {
  it('accepte une liste vide (annotation effacée)', () => {
    expect(routePhotoHoldsInputSchema.safeParse({ holds: [] }).success).toBe(true)
  })

  it('accepte des prises aux bornes du cadre', () => {
    const holds = [
      { number: 1, x: 0, y: 1 },
      { number: 2, x: 1, y: 0 },
    ]
    expect(routePhotoHoldsInputSchema.safeParse({ holds }).success).toBe(true)
  })

  it.each([
    ['numéro nul', { number: 0, x: 0.5, y: 0.5 }],
    ['numéro négatif', { number: -1, x: 0.5, y: 0.5 }],
    ['numéro non entier', { number: 1.5, x: 0.5, y: 0.5 }],
    ['x négatif', { number: 1, x: -0.01, y: 0.5 }],
    ['x au-delà du cadre', { number: 1, x: 1.01, y: 0.5 }],
    ['y au-delà du cadre', { number: 1, x: 0.5, y: 2 }],
    ['x non fini', { number: 1, x: Number.NaN, y: 0.5 }],
  ])('refuse une prise invalide : %s', (_label, hold) => {
    expect(routePhotoHoldsInputSchema.safeParse({ holds: [hold] }).success).toBe(false)
  })

  it('refuse deux prises de même numéro', () => {
    const holds = [
      { number: 3, x: 0.1, y: 0.1 },
      { number: 3, x: 0.9, y: 0.9 },
    ]
    expect(routePhotoHoldsInputSchema.safeParse({ holds }).success).toBe(false)
  })

  it('refuse plus de prises que le plafond', () => {
    const holds = Array.from({ length: ROUTE_PHOTO_MAX_HOLDS + 1 }, (_, i) => ({
      number: i + 1,
      x: 0.5,
      y: 0.5,
    }))
    expect(routePhotoHoldsInputSchema.safeParse({ holds }).success).toBe(false)
  })
})

describe('renumberByHeight', () => {
  it('donne 1 à la prise la plus basse sur la photo (y le plus grand)', () => {
    const holds: RouteHold[] = [
      { number: 9, x: 0.5, y: 0.1 },
      { number: 8, x: 0.4, y: 0.9 },
      { number: 7, x: 0.6, y: 0.5 },
    ]
    expect(renumberByHeight(holds)).toEqual([
      { number: 1, x: 0.4, y: 0.9 },
      { number: 2, x: 0.6, y: 0.5 },
      { number: 3, x: 0.5, y: 0.1 },
    ])
  })

  it('départage deux prises à la même hauteur par la gauche', () => {
    const holds: RouteHold[] = [
      { number: 1, x: 0.8, y: 0.5 },
      { number: 2, x: 0.2, y: 0.5 },
    ]
    expect(renumberByHeight(holds).map((hold) => hold.x)).toEqual([0.2, 0.8])
  })

  it('ne modifie pas la liste reçue et renvoie une liste vide pour une liste vide', () => {
    const holds: RouteHold[] = [
      { number: 5, x: 0.1, y: 0.2 },
      { number: 6, x: 0.3, y: 0.8 },
    ]
    const copy = structuredClone(holds)
    renumberByHeight(holds)
    expect(holds).toEqual(copy)
    expect(renumberByHeight([])).toEqual([])
  })

  it('produit toujours une numérotation continue de 1 à N', () => {
    const holds: RouteHold[] = [
      { number: 40, x: 0.1, y: 0.3 },
      { number: 12, x: 0.2, y: 0.6 },
      { number: 3, x: 0.3, y: 0.9 },
    ]
    expect(renumberByHeight(holds).map((hold) => hold.number)).toEqual([1, 2, 3])
  })
})

describe('nextHoldNumber', () => {
  it('commence à 1', () => {
    expect(nextHoldNumber([])).toBe(1)
  })

  it('suit le dernier numéro quand la liste est continue', () => {
    expect(
      nextHoldNumber([
        { number: 1, x: 0, y: 0 },
        { number: 2, x: 0, y: 0 },
      ]),
    ).toBe(3)
  })

  it('comble d’abord le trou laissé par une suppression', () => {
    expect(
      nextHoldNumber([
        { number: 1, x: 0, y: 0 },
        { number: 2, x: 0, y: 0 },
        { number: 4, x: 0, y: 0 },
      ]),
    ).toBe(3)
  })
})

describe('addHold', () => {
  it('prend le prochain numéro libre et ramène la position dans le cadre', () => {
    const holds: RouteHold[] = [
      { number: 1, x: 0.2, y: 0.8 },
      { number: 3, x: 0.3, y: 0.4 },
    ]
    expect(addHold(holds, 1.4, -0.2)).toEqual([...holds, { number: 2, x: 1, y: 0 }])
  })

  it('ne modifie pas la liste reçue', () => {
    const holds: RouteHold[] = [{ number: 1, x: 0.5, y: 0.5 }]
    addHold(holds, 0.1, 0.1)
    expect(holds).toHaveLength(1)
  })
})

describe('moveHold', () => {
  const holds: RouteHold[] = [
    { number: 1, x: 0.2, y: 0.8 },
    { number: 2, x: 0.3, y: 0.4 },
  ]

  it('déplace une seule prise, sans changer son numéro', () => {
    expect(moveHold(holds, 2, 0.6, 0.5)).toEqual([
      { number: 1, x: 0.2, y: 0.8 },
      { number: 2, x: 0.6, y: 0.5 },
    ])
  })

  it('reste dans le cadre de la photo', () => {
    expect(moveHold(holds, 1, -3, 9)[0]).toEqual({ number: 1, x: 0, y: 1 })
  })

  it('est sans effet sur un numéro qui n’existe pas', () => {
    expect(moveHold(holds, 7, 0.5, 0.5)).toEqual(holds)
  })
})

describe('removeHold', () => {
  it('retire la prise et laisse un trou dans la numérotation', () => {
    const holds: RouteHold[] = [
      { number: 1, x: 0, y: 0 },
      { number: 2, x: 0, y: 0 },
      { number: 3, x: 0, y: 0 },
    ]
    expect(removeHold(holds, 2).map((hold) => hold.number)).toEqual([1, 3])
    expect(removeHold(holds, 9)).toEqual(holds)
  })
})

describe('changeHoldNumber', () => {
  const holds: RouteHold[] = [
    { number: 1, x: 0.1, y: 0.1 },
    { number: 2, x: 0.2, y: 0.2 },
  ]

  it('renumérote une prise', () => {
    expect(changeHoldNumber(holds, 2, 5)).toEqual({
      ok: true,
      holds: [
        { number: 1, x: 0.1, y: 0.1 },
        { number: 5, x: 0.2, y: 0.2 },
      ],
    })
  })

  it('refuse un numéro déjà pris, sans rien échanger en silence', () => {
    expect(changeHoldNumber(holds, 2, 1)).toEqual({ ok: false, reason: 'taken' })
  })

  it.each([0, -1, 1.5, Number.NaN])('refuse le numéro invalide %s', (to) => {
    expect(changeHoldNumber(holds, 1, to)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepte de garder le même numéro', () => {
    expect(changeHoldNumber(holds, 1, 1)).toEqual({ ok: true, holds })
  })
})
