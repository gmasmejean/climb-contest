import type { PublicRankingResponse } from '@climbcontest/contracts'
import { category, competition, type Database } from '@climbcontest/db'
import { and, asc, eq, isNull } from 'drizzle-orm'

import { assembleCategoryRanking } from '../public-ranking'

type CompetitionRow = typeof competition.$inferSelect

export interface CategoryResults {
  categoryId: string
  categoryLabel: string
  ranking: PublicRankingResponse
}

export interface CompetitionResults {
  competitionName: string
  venue: string
  startsOn: string
  endsOn: string
  format: 'contest' | 'phases'
  categories: CategoryResults[]
}

/**
 * Les résultats de toutes les catégories (ou d'une seule) — calculés par
 * `assembleCategoryRanking`, le MÊME code que la page publique : un export
 * ne recalcule jamais un classement à sa façon (ADR-013, `CLAUDE.md` : la
 * logique de classement vit à un seul endroit).
 */
export async function loadCompetitionResults(
  db: Database,
  currentCompetition: CompetitionRow,
  options: { categoryId?: string } = {},
): Promise<CompetitionResults | null> {
  const categories = await db
    .select({ id: category.id, label: category.label })
    .from(category)
    .where(
      and(
        eq(category.competitionId, currentCompetition.id),
        isNull(category.deletedAt),
        ...(options.categoryId ? [eq(category.id, options.categoryId)] : []),
      ),
    )
    .orderBy(asc(category.displayOrder))
  if (options.categoryId && categories.length === 0) return null

  const results: CategoryResults[] = []
  for (const cat of categories) {
    results.push({
      categoryId: cat.id,
      categoryLabel: cat.label,
      ranking: await assembleCategoryRanking(db, currentCompetition, cat.id),
    })
  }
  return {
    competitionName: currentCompetition.name,
    venue: currentCompetition.venue,
    startsOn: currentCompetition.startsOn,
    endsOn: currentCompetition.endsOn,
    format: currentCompetition.format as 'contest' | 'phases',
    categories: results,
  }
}

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}

export function roundTypeLabel(type: string): string {
  return ROUND_TYPE_LABELS[type] ?? type
}

/** Même vocabulaire que l'écran juge et la page publique (`format-ascent.ts` côté web). */
export function formatAscentResult(entry: {
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  isTop: boolean
  holdNumber: number | null
  modifier: 'none' | 'plus'
}): string {
  if (entry.status === 'dns') return 'DNS'
  if (entry.status === 'dnf') return 'DNF'
  if (entry.status === 'dsq') return 'DSQ'
  if (entry.isTop) return 'TOP'
  return `prise ${entry.holdNumber}${entry.modifier === 'plus' ? '+' : ''}`
}
