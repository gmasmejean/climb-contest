import { toCsv } from './csv'
import { formatAscentResult, roundTypeLabel, type CompetitionResults } from './results'

const HEADER = [
  'categorie',
  'rang',
  'dossard',
  'nom',
  'prenom',
  'club',
  'tour_atteint',
  'detail',
  'provisoire',
] as const

/**
 * Une ligne par compétiteur et par catégorie. La colonne `detail` porte le
 * résultat de chaque voie de chaque tour joué — lisible dans un tableur, sans
 * que le nombre de colonnes change d'une catégorie ou d'un format à l'autre.
 *
 * Que ce que la page publique montre (nom, prénom, club, dossard) : jamais
 * d'année de naissance ni de licence (SPEC.md §6.4).
 */
export function resultsToCsv(results: CompetitionResults): string {
  const rows: (string | number | null)[][] = [[...HEADER]]

  for (const cat of results.categories) {
    for (const entry of cat.ranking.entries) {
      const reached = entry.rounds.find((r) => r.roundId === entry.reachedRoundId)
      const detail = entry.rounds
        .map((roundDetail) =>
          roundDetail.routes
            .map((routeResult) => {
              const prefix =
                results.format === 'phases' ? `${roundTypeLabel(roundDetail.roundType)} ` : ''
              return `${prefix}voie ${routeResult.routeNumber} : ${formatAscentResult(routeResult)} (rang ${routeResult.routeRank})`
            })
            .join(' | '),
        )
        .join(' | ')
      rows.push([
        cat.categoryLabel,
        entry.rank,
        entry.bib,
        entry.lastName,
        entry.firstName,
        entry.club,
        results.format === 'phases' && reached ? roundTypeLabel(reached.roundType) : '',
        detail,
        cat.ranking.provisional ? 'oui' : 'non',
      ])
    }
  }
  return toCsv(rows)
}
