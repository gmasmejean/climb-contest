import type { ScoringEngine } from './types'

const registry = new Map<string, ScoringEngine>()

export function registerScoringEngine(engine: ScoringEngine): void {
  registry.set(engine.id, engine)
}

export function getScoringEngine(id: string): ScoringEngine {
  const engine = registry.get(id)
  if (engine === undefined) {
    throw new Error(`Moteur de cotation inconnu : "${id}".`)
  }
  return engine
}
