import type { Clock } from '../types'

/** Horloge déterministe pour les tests — `now()` avance manuellement, `random()` est scriptable. */
export class FakeClock implements Clock {
  private currentNow: number
  private readonly randomValues: number[]
  private randomIndex = 0

  constructor(options: { now?: number; randomValues?: number[] } = {}) {
    this.currentNow = options.now ?? 0
    this.randomValues = options.randomValues ?? [0]
  }

  now(): number {
    return this.currentNow
  }

  advance(ms: number): void {
    this.currentNow += ms
  }

  setNow(now: number): void {
    this.currentNow = now
  }

  random(): number {
    const index = this.randomIndex % this.randomValues.length
    const value = this.randomValues[index]
    this.randomIndex += 1
    return value ?? 0
  }
}
