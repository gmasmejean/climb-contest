export * from './types'
export * from './rank-groups'
export { registerScoringEngine, getScoringEngine } from './registry'
export { ffmeDifficulty2026Engine, getQualifiers } from './engines/ffme-difficulty-2026'
export type { FfmeDifficulty2026Config } from './engines/ffme-difficulty-2026'

import { ffmeDifficulty2026Engine } from './engines/ffme-difficulty-2026'
import { registerScoringEngine } from './registry'

registerScoringEngine(ffmeDifficulty2026Engine)
