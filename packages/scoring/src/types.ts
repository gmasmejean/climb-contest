// Domain types for FFME scoring. Zero-dependency package (SPEC.md §6.2):
// nothing here comes from packages/contracts (which depends on Zod and
// Drizzle) or packages/db.

export type Modifier = 'none' | 'plus'
export type AscentStatus = 'valid' | 'dns' | 'dnf' | 'dsq'

export interface Ascent {
  readonly competitorId: string
  readonly holdNumber: number | null
  /** ADR-003: copy of route.hold_count at the moment of recording. */
  readonly holdCount: number
  readonly modifier: Modifier
  readonly isTop: boolean
  readonly status: AscentStatus
  readonly climbTimeMs: number | null
}

export interface Route {
  readonly id: string
  readonly holdCount: number
}

export type ScoreValue = number

export interface RouteRankEntry {
  readonly competitorId: string
  readonly scoreValue: ScoreValue
  readonly rank: number
}

export interface RouteRanking {
  readonly routeId: string
  readonly holdCount: number
  readonly entries: readonly RouteRankEntry[]
}

export interface RoundRankEntry {
  readonly competitorId: string
  readonly rank: number
  /** Displayed value (rounded geometric mean, or score_total in contest mode). Never used for sorting. */
  readonly combinedRank: number
}

export interface RoundRanking {
  readonly entries: readonly RoundRankEntry[]
}

export type RoundContext =
  | { readonly format: 'phases'; readonly previousRoundRanking?: RoundRanking }
  | { readonly format: 'contest'; readonly routesCounted: number }

export interface FinalRankEntry {
  readonly competitorId: string
  readonly rank: number
  readonly reachedRoundId: string
}

export interface FinalRanking {
  readonly entries: readonly FinalRankEntry[]
}

export interface CompetitionContext {
  /** From the earliest round to the most recent. */
  readonly roundRankings: readonly { readonly roundId: string; readonly ranking: RoundRanking }[]
}

/**
 * Structural subset of the Zod API that a real Zod schema satisfies without
 * this package importing zod (SPEC.md §6.2: zero dependency, "not even Zod").
 */
export interface ConfigSchema<TConfig> {
  parse(input: unknown): TConfig
}

export interface ScoringEngine<TConfig = unknown> {
  readonly id: string
  readonly label: string
  readonly configSchema: ConfigSchema<TConfig>
  scoreAscent(ascent: Ascent, route: Route): ScoreValue
  rankRoute(ascents: readonly Ascent[], route: Route): RouteRanking
  rankRound(routeRankings: readonly RouteRanking[], ctx: RoundContext): RoundRanking
  rankFinal(ctx: CompetitionContext): FinalRanking
}
