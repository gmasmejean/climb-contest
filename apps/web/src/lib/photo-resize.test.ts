import { describe, expect, it } from 'vitest'

import { fitWithin } from './photo-resize'

describe('fitWithin', () => {
  it('ramène le grand côté à la limite en gardant les proportions', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('n’agrandit jamais une image déjà plus petite', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('arrondit à des pixels entiers, au moins 1', () => {
    expect(fitWithin(1601, 1000, 1600)).toEqual({ width: 1600, height: 999 })
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })
})
