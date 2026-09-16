import type { ScoringEngine } from '../../types'
import { ffmeDifficulty2026ConfigSchema, type FfmeDifficulty2026Config } from './config'
import { rankFinal } from './rank-final'
import { rankRound } from './rank-round'
import { rankRoute } from './rank-route'
import { scoreAscent } from './score-ascent'

export const ffmeDifficulty2026Engine: ScoringEngine<FfmeDifficulty2026Config> = {
  id: 'ffme-difficulty-2026',
  label: 'FFME — Difficulté 2026',
  configSchema: ffmeDifficulty2026ConfigSchema,
  scoreAscent,
  rankRoute,
  rankRound,
  rankFinal,
}

export { getQualifiers } from './qualifiers'
export type { FfmeDifficulty2026Config } from './config'
