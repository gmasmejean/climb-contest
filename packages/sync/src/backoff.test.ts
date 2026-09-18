import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { computeBackoffDelayMs } from './backoff'
import { FakeClock } from './test-utils/fake-clock'

describe('computeBackoffDelayMs', () => {
  it('croît de façon exponentielle avec le nombre de tentatives (jitter à 1 pour lire la borne supérieure)', () => {
    const clock = new FakeClock({ randomValues: [1] })
    expect(computeBackoffDelayMs(0, clock, { baseMs: 1000, capMs: 30_000 })).toBe(1000)
    expect(computeBackoffDelayMs(1, clock, { baseMs: 1000, capMs: 30_000 })).toBe(2000)
    expect(computeBackoffDelayMs(2, clock, { baseMs: 1000, capMs: 30_000 })).toBe(4000)
  })

  it('est plafonné par capMs quel que soit le nombre de tentatives', () => {
    const clock = new FakeClock({ randomValues: [1] })
    expect(computeBackoffDelayMs(10, clock, { baseMs: 1000, capMs: 30_000 })).toBe(30_000)
    expect(computeBackoffDelayMs(50, clock, { baseMs: 1000, capMs: 30_000 })).toBe(30_000)
  })

  it('un jitter nul renvoie toujours 0', () => {
    const clock = new FakeClock({ randomValues: [0] })
    expect(computeBackoffDelayMs(5, clock, { baseMs: 1000, capMs: 30_000 })).toBe(0)
  })

  it('propriété : le délai est toujours dans [0, min(capMs, baseMs * 2^tentative)]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.float({ min: Math.fround(0), max: Math.fround(0.999_999), noNaN: true }),
        (attempt, randomValue) => {
          const clock = new FakeClock({ randomValues: [randomValue] })
          const baseMs = 1000
          const capMs = 30_000
          const delay = computeBackoffDelayMs(attempt, clock, { baseMs, capMs })
          const upperBound = Math.min(capMs, baseMs * 2 ** attempt)
          expect(delay).toBeGreaterThanOrEqual(0)
          expect(delay).toBeLessThanOrEqual(upperBound)
        },
      ),
    )
  })

  it('utilise des valeurs par défaut raisonnables sans options', () => {
    const clock = new FakeClock({ randomValues: [1] })
    expect(computeBackoffDelayMs(0, clock)).toBe(1000)
    expect(computeBackoffDelayMs(20, clock)).toBe(30_000)
  })
})
