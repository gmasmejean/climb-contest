import type {
  PublicRankingEntry,
  PublicRankingResponse,
  PublicRankingRoundDetail,
} from '@climbcontest/contracts'
import {
  ascent,
  competition,
  competitor,
  round,
  roundQualifier,
  roundRoute,
  route,
  type Database,
} from '@climbcontest/db'
import {
  getScoringEngine,
  getQualifiers,
  type Ascent as EngineAscent,
  type AscentStatus,
  type CompetitionContext,
  type Modifier,
  type RoundContext,
  type RoundRanking,
  type RouteRanking,
} from '@climbcontest/scoring'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

type CompetitionRow = typeof competition.$inferSelect
type RoundStatus = 'draft' | 'open' | 'closed' | 'published'
type RoundType = 'qualification' | 'semifinal' | 'final'

/**
 * Mêmes statuts que `judge-ascents.ts`'s `EXPECTED_COMPETITOR_STATUSES` —
 * dupliqué à dessein plutôt qu'importé : ce n'est pas exporté par ce
 * fichier-là, et une constante à deux valeurs ne justifie pas un
 * couplage entre les deux routes (voir TODO.md pour le suivi).
 */
const ROSTER_COMPETITOR_STATUSES = ['registered', 'present'] as const

interface RawAscentRow {
  competitorId: string
  routeId: string
  holdNumber: number | null
  holdCount: number
  modifier: string
  isTop: boolean
  status: string
  climbTimeMs: number | null
}

export interface RouteMeta {
  routeId: string
  number: number
  name: string | null
  holdCount: number
}

export interface RoundMeta {
  roundId: string
  type: RoundType
  status: RoundStatus
  displayOrder: number
  qualifyingCount: number | null
  routes: RouteMeta[]
}

export interface RoundComputation {
  roundId: string
  type: RoundType
  status: RoundStatus
  routes: RouteMeta[]
  routeRankings: readonly RouteRanking[]
  ranking: RoundRanking
  /** Fusion réel + synthétique (DNS) — sert à la fois au calcul et à l'affichage. */
  ascentsByRoute: ReadonlyMap<string, ReadonlyMap<string, EngineAscent>>
}

/**
 * Assemble le classement public d'une catégorie — point d'entrée de
 * `GET /public/:slug/rankings`. Charge les `ascent` actifs en base
 * (ADR-013), les convertit vers les types internes de `packages/scoring`
 * (zéro dépendance, SPEC.md §6.2 — jamais de type DB/Zod), et appelle
 * `rankRoute` → `rankRound` → `rankFinal` du moteur enregistré pour cette
 * compétition. Le serveur fait autorité (SPEC.md §4.6) : ce même calcul
 * n'est jamais fait côté client pour l'écran public (contrairement à
 * l'affichage optimiste hors ligne du juge).
 */
export async function assembleCategoryRanking(
  db: Database,
  currentCompetition: Pick<CompetitionRow, 'id' | 'format' | 'scoringEngineId' | 'scoringConfig'>,
  categoryId: string,
  now: () => Date = () => new Date(),
): Promise<PublicRankingResponse> {
  const engine = getScoringEngine(currentCompetition.scoringEngineId)
  const { roundMetas, perRound } = await computeCategoryRounds(db, currentCompetition, categoryId)

  if (roundMetas.length === 0) {
    return {
      categoryId,
      started: false,
      provisional: false,
      generatedAt: now().toISOString(),
      entries: [],
    }
  }

  const competitionContext: CompetitionContext = {
    roundRankings: perRound.map((r) => ({ roundId: r.roundId, ranking: r.ranking })),
  }
  const finalRanking = engine.rankFinal(competitionContext)

  const competitorById = await loadCompetitorDisplayInfo(db, currentCompetition.id, categoryId)
  const provisional = perRound.some((r) => r.status !== 'published')

  const entries: PublicRankingEntry[] = finalRanking.entries
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => {
      const info = competitorById.get(entry.competitorId)
      const rounds = perRound
        .filter((r) => r.ranking.entries.some((e) => e.competitorId === entry.competitorId))
        .map((r) => buildRoundDetail(r, entry.competitorId))

      return {
        rank: entry.rank,
        bib: info?.bib ?? null,
        firstName: info?.firstName ?? '',
        lastName: info?.lastName ?? '',
        club: info?.clubName ?? null,
        reachedRoundId: entry.reachedRoundId,
        rounds,
      }
    })

  return {
    categoryId,
    started: true,
    provisional,
    generatedAt: now().toISOString(),
    entries,
  }
}

/**
 * Calcule, tour par tour, le classement d'une catégorie — la boucle
 * partagée entre le classement public et la figeage des qualifiés
 * (`lib/round-qualifiers.ts`, ADR-054).
 *
 * Le roster d'un tour est, par ordre de priorité : (1) la liste figée en
 * base pour ce (tour, catégorie) — elle fait foi dès qu'elle existe, quels
 * que soient les statuts ou corrections ultérieurs ; (2) au premier tour,
 * toute la catégorie ; (3) sinon, les qualifiés recalculés du tour précédent,
 * comme avant le Lot 9 (tours ouverts avant l'introduction de la figeage).
 *
 * `stopAfterRoundId` : s'arrête après avoir calculé ce tour (inclus), pour ne
 * pas payer les tours suivants quand on n'en a pas besoin.
 */
export async function computeCategoryRounds(
  db: Database,
  currentCompetition: Pick<CompetitionRow, 'id' | 'format' | 'scoringEngineId' | 'scoringConfig'>,
  categoryId: string,
  options: { stopAfterRoundId?: string } = {},
): Promise<{ roundMetas: readonly RoundMeta[]; perRound: RoundComputation[] }> {
  const engine = getScoringEngine(currentCompetition.scoringEngineId)
  const roundMetas = await loadContributingRounds(db, currentCompetition.id, categoryId)
  if (roundMetas.length === 0) return { roundMetas, perRound: [] }

  const fullRoster = await loadFullCategoryRoster(db, currentCompetition.id, categoryId)

  // Config de cotation traitée de façon structurelle, pas générique : v1
  // n'a qu'un seul moteur enregistré (ADR-011), et `competitions.ts` fait
  // déjà la même hypothèse sur `routesCounted` pour le format contest
  // (ADR-023 — friction connue, notée dans DECISIONS.md, pas résolue ici).
  const scoringConfig = currentCompetition.scoringConfig as { routesCounted?: number }
  const routesCounted = scoringConfig.routesCounted ?? 1

  const perRound: RoundComputation[] = []
  let roster: readonly string[] = fullRoster
  let previousRoundRanking: RoundRanking | undefined

  for (const roundMeta of roundMetas) {
    const frozen = await loadFrozenRoster(db, roundMeta.roundId, categoryId)
    if (frozen) {
      roster = frozen
    } else if (perRound.length > 0) {
      const previous = roundMetas[perRound.length - 1]
      if (!previous) throw new Error('Incohérence interne : tour précédent introuvable.')
      // Roster vide (catégorie sans compétiteur) : `getQualifiers` refuse un
      // `qualifyingCount` de 0, mais le résultat est trivial — pas besoin de
      // l'appeler pour savoir que personne ne se qualifie.
      roster =
        roster.length === 0
          ? []
          : getQualifiers(
              // Non-null : on vient de calculer ce tour précédent dans cette même boucle.
              perRound[perRound.length - 1]!.ranking,
              previous.qualifyingCount ?? roster.length,
            )
    }

    const rawRows = await fetchActiveAscentsForRound(
      db,
      roundMeta.roundId,
      roundMeta.routes.map((r) => r.routeId),
    )
    const rawByRoute = new Map<string, RawAscentRow[]>()
    for (const rawRow of rawRows) {
      const list = rawByRoute.get(rawRow.routeId) ?? []
      list.push(rawRow)
      rawByRoute.set(rawRow.routeId, list)
    }

    const ascentsByRoute = new Map<string, ReadonlyMap<string, EngineAscent>>()
    const routeRankings: RouteRanking[] = []
    for (const routeMeta of roundMeta.routes) {
      const rowsForRoute = rawByRoute.get(routeMeta.routeId) ?? []
      const merged =
        currentCompetition.format === 'phases'
          ? mergeRosterWithDnsPlaceholders(roster, rowsForRoute, routeMeta.holdCount)
          : realAscentsOnly(rowsForRoute)
      ascentsByRoute.set(routeMeta.routeId, merged)
      routeRankings.push(
        engine.rankRoute([...merged.values()], { id: routeMeta.routeId, holdCount: routeMeta.holdCount }),
      )
    }

    // `exactOptionalPropertyTypes` : `previousRoundRanking` doit être omis,
    // pas assigné explicitement à `undefined`, quand il n'y a pas de tour
    // précédent (premier tour du roundMetas).
    const ctx: RoundContext =
      currentCompetition.format === 'phases'
        ? { format: 'phases', ...(previousRoundRanking && { previousRoundRanking }) }
        : { format: 'contest', routesCounted }
    const ranking = engine.rankRound(routeRankings, ctx)

    perRound.push({
      roundId: roundMeta.roundId,
      type: roundMeta.type,
      status: roundMeta.status,
      routes: roundMeta.routes,
      routeRankings,
      ranking,
      ascentsByRoute,
    })
    previousRoundRanking = ranking
    if (roundMeta.roundId === options.stopAfterRoundId) break
  }

  return { roundMetas, perRound }
}

/**
 * La liste figée d'un (tour, catégorie), ou `null` s'il n'y en a pas — premier
 * tour de la catégorie, tour ouvert avant le Lot 9, ou catégorie sans aucun
 * qualifié (indiscernable d'une absence de figeage, sans conséquence : il n'y
 * a alors personne à restreindre).
 */
async function loadFrozenRoster(
  db: Database,
  roundId: string,
  categoryId: string,
): Promise<readonly string[] | null> {
  const rows = await db
    .select({ competitorId: roundQualifier.competitorId })
    .from(roundQualifier)
    .where(and(eq(roundQualifier.roundId, roundId), eq(roundQualifier.categoryId, categoryId)))
  return rows.length === 0 ? null : rows.map((row) => row.competitorId)
}

function buildRoundDetail(roundComputation: RoundComputation, competitorId: string): PublicRankingRoundDetail {
  const roundEntry = roundComputation.ranking.entries.find((e) => e.competitorId === competitorId)
  /* v8 ignore next 3 -- appelé uniquement pour un competitorId déjà confirmé présent dans ce tour */
  if (!roundEntry) {
    throw new Error(`Compétiteur ${competitorId} absent du tour ${roundComputation.roundId}.`)
  }

  const routes = roundComputation.routes.map((routeMeta) => {
    const routeRanking = roundComputation.routeRankings.find((rr) => rr.routeId === routeMeta.routeId)
    const rankEntry = routeRanking?.entries.find((e) => e.competitorId === competitorId)
    const ascentEntry = roundComputation.ascentsByRoute.get(routeMeta.routeId)?.get(competitorId)
    /* v8 ignore next 3 -- toute voie du tour porte une entrée pour chaque membre du roster de ce tour */
    if (!rankEntry || !ascentEntry) {
      throw new Error(`Voie ${routeMeta.routeId} incohérente pour le compétiteur ${competitorId}.`)
    }
    return {
      routeId: routeMeta.routeId,
      routeNumber: routeMeta.number,
      routeName: routeMeta.name,
      holdNumber: ascentEntry.holdNumber,
      modifier: ascentEntry.modifier,
      isTop: ascentEntry.isTop,
      status: ascentEntry.status,
      routeRank: rankEntry.rank,
    }
  })

  return {
    roundId: roundComputation.roundId,
    roundType: roundComputation.type,
    combinedRank: roundEntry.combinedRank,
    routes,
  }
}

/**
 * Tous les tours (statut ≠ `draft`) qui utilisent au moins une voie de
 * cette catégorie, dans l'ordre. Un tour `draft` n'a encore aucune voie
 * ouverte pour personne : il ne contribue à rien (cohérent avec
 * DECISIONS.md ADR-030 — le vrai pilotage d'ouverture reste au Lot 8).
 */
async function loadContributingRounds(
  db: Database,
  competitionId: string,
  categoryId: string,
): Promise<readonly RoundMeta[]> {
  const links = await db
    .select({
      roundId: round.id,
      type: round.type,
      status: round.status,
      displayOrder: round.displayOrder,
      qualifyingCount: round.qualifyingCount,
      routeId: roundRoute.routeId,
      routeNumber: route.number,
      routeName: route.name,
      routeHoldCount: route.holdCount,
    })
    .from(roundRoute)
    .innerJoin(round, eq(round.id, roundRoute.roundId))
    .innerJoin(route, eq(route.id, roundRoute.routeId))
    .where(
      and(
        eq(round.competitionId, competitionId),
        eq(roundRoute.categoryId, categoryId),
        isNull(round.deletedAt),
      ),
    )
    .orderBy(asc(round.displayOrder))

  const byRound = new Map<string, RoundMeta>()
  for (const link of links) {
    if (link.status === 'draft') continue
    const existing = byRound.get(link.roundId)
    const routeMeta: RouteMeta = {
      routeId: link.routeId,
      number: link.routeNumber,
      name: link.routeName,
      holdCount: link.routeHoldCount,
    }
    if (existing) {
      existing.routes.push(routeMeta)
    } else {
      byRound.set(link.roundId, {
        roundId: link.roundId,
        type: link.type as RoundType,
        status: link.status as RoundStatus,
        displayOrder: link.displayOrder,
        qualifyingCount: link.qualifyingCount,
        routes: [routeMeta],
      })
    }
  }

  return [...byRound.values()].sort((a, b) => a.displayOrder - b.displayOrder)
}

async function loadFullCategoryRoster(
  db: Database,
  competitionId: string,
  categoryId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: competitor.id })
    .from(competitor)
    .where(
      and(
        eq(competitor.competitionId, competitionId),
        eq(competitor.categoryId, categoryId),
        inArray(competitor.status, [...ROSTER_COMPETITOR_STATUSES]),
        isNull(competitor.deletedAt),
      ),
    )
  return rows.map((row) => row.id)
}

interface CompetitorDisplayInfo {
  bib: number | null
  firstName: string
  lastName: string
  clubName: string | null
}

/**
 * Toute la catégorie (pas seulement le roster « registered/present ») :
 * un compétiteur retiré après avoir grimpé doit rester affichable dans le
 * détail d'un tour déjà calculé.
 */
async function loadCompetitorDisplayInfo(
  db: Database,
  competitionId: string,
  categoryId: string,
): Promise<ReadonlyMap<string, CompetitorDisplayInfo>> {
  const rows = await db
    .select({
      id: competitor.id,
      bib: competitor.bib,
      firstName: competitor.firstName,
      lastName: competitor.lastName,
      clubName: competitor.clubName,
    })
    .from(competitor)
    .where(and(eq(competitor.competitionId, competitionId), eq(competitor.categoryId, categoryId)))
  return new Map(rows.map((row) => [row.id, row]))
}

async function fetchActiveAscentsForRound(
  db: Database,
  roundId: string,
  routeIds: readonly string[],
): Promise<readonly RawAscentRow[]> {
  if (routeIds.length === 0) return []
  return db
    .select({
      competitorId: ascent.competitorId,
      routeId: ascent.routeId,
      holdNumber: ascent.holdNumber,
      holdCount: ascent.holdCount,
      modifier: ascent.modifier,
      isTop: ascent.isTop,
      status: ascent.status,
      climbTimeMs: ascent.climbTimeMs,
    })
    .from(ascent)
    .where(
      and(
        eq(ascent.roundId, roundId),
        inArray(ascent.routeId, [...routeIds]),
        isNull(ascent.supersededBy),
        isNull(ascent.conflictGroup),
      ),
    )
}

/**
 * Format phases : complète le roster attendu de ce tour avec des `Ascent`
 * DNS synthétiques (affichage uniquement, jamais écrits en base) pour
 * chaque membre du roster absent sur CETTE voie — précondition de
 * `rankRound` (DECISIONS.md ADR-021 : chaque compétiteur doit apparaître
 * dans le classement de chaque voie du tour, y compris en DNS). Exportée
 * pour être testée directement, sans conteneur (`public-ranking.test.ts`).
 */
export function mergeRosterWithDnsPlaceholders(
  roster: readonly string[],
  rawRows: readonly RawAscentRow[],
  holdCount: number,
): ReadonlyMap<string, EngineAscent> {
  const byCompetitor = new Map(rawRows.map((row) => [row.competitorId, row]))
  const merged = new Map<string, EngineAscent>()
  for (const competitorId of roster) {
    const raw = byCompetitor.get(competitorId)
    merged.set(competitorId, raw ? toEngineAscent(raw) : dnsPlaceholder(competitorId, holdCount))
  }
  return merged
}

/**
 * Format contest : aucune synthèse — `rankRoundContest` (packages/scoring)
 * combine déjà librement des ensembles de compétiteurs différents d'une
 * voie à l'autre (un climber peut ne pas avoir tenté toutes les voies).
 */
function realAscentsOnly(rawRows: readonly RawAscentRow[]): ReadonlyMap<string, EngineAscent> {
  return new Map(rawRows.map((row) => [row.competitorId, toEngineAscent(row)]))
}

/** Les colonnes `modifier`/`status` sont `text` + CHECK en base (ADR-018), pas des littéraux TS — la contrainte garantit déjà ces valeurs, pas besoin de revalider une donnée interne (CLAUDE.md : valider aux frontières, faire confiance au reste). */
function toEngineAscent(row: RawAscentRow): EngineAscent {
  return {
    competitorId: row.competitorId,
    holdNumber: row.holdNumber,
    holdCount: row.holdCount,
    modifier: row.modifier as Modifier,
    isTop: row.isTop,
    status: row.status as AscentStatus,
    climbTimeMs: row.climbTimeMs,
  }
}

function dnsPlaceholder(competitorId: string, holdCount: number): EngineAscent {
  return {
    competitorId,
    holdNumber: null,
    holdCount,
    modifier: 'none',
    isTop: false,
    status: 'dns',
    climbTimeMs: null,
  }
}
