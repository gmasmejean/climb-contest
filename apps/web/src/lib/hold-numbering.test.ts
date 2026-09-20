import type { RouteHold } from '@climbcontest/contracts'
import { describe, expect, it } from 'vitest'

import { highestHoldNumber, numberingGap } from './hold-numbering'

const at = (...numbers: number[]): RouteHold[] =>
  numbers.map((number) => ({ number, x: 0.5, y: 0.5 }))

describe('highestHoldNumber', () => {
  it('vaut 0 sans prise', () => {
    expect(highestHoldNumber([])).toBe(0)
  })

  it('donne le plus haut numéro, quel que soit l’ordre', () => {
    expect(highestHoldNumber(at(3, 1, 7, 2))).toBe(7)
  })
})

describe('numberingGap', () => {
  it('est nul quand la numérotation est continue ou vide', () => {
    expect(numberingGap([])).toBeNull()
    expect(numberingGap(at(1, 2, 3))).toBeNull()
    expect(numberingGap(at(3, 1, 2))).toBeNull()
  })

  it('donne le premier numéro manquant sous le plus haut', () => {
    expect(numberingGap(at(1, 2, 4, 5))).toBe(3)
    expect(numberingGap(at(2, 3))).toBe(1)
    expect(numberingGap(at(1, 3, 6))).toBe(2)
  })
})
