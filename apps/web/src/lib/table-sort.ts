import type { DataListColumn, DataListSort } from '@climbcontest/ui'

/**
 * Tri des tableaux de l'espace organisateur (Lot 18). Fonctions pures : aucune
 * date, aucun accès réseau. Les comparateurs sont partagés avec la recherche de
 * la liste des compétitions (`competition-list-view.ts`, Lot 11), qui les
 * définissait jusqu'ici pour elle seule.
 */

/** Minuscules, sans accents, sans espaces aux extrémités. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/** Ordre alphabétique français, insensible à la casse et aux accents. */
export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' })
}

/** Ordre numérique. Les absences sont traitées par `sortRows`, jamais ici. */
export function compareNumber(a: number, b: number): number {
  return a - b
}

/**
 * Trie selon la colonne désignée, sans jamais modifier `rows`. Deux garanties :
 *
 * — ce qui est ABSENT (dossard non attribué, juge jamais vu) reste en bas dans
 *   les DEUX sens. Inverser le tri ne doit pas faire remonter le vide en tête :
 *   l'organisateur trie par dossard pour voir les dossards, pas les trous ;
 * — le tri est stable, donc l'ordre reçu départage silencieusement. `tieBreak`
 *   permet d'imposer un départage explicite quand il compte.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: DataListSort | null,
  columns: readonly DataListColumn<Row>[],
  tieBreak?: (a: Row, b: Row) => number,
): Row[] {
  const column = sort === null ? undefined : columns.find((candidate) => candidate.key === sort.key)
  const compare = column?.compare
  if (sort === null || column === undefined || compare === undefined) return [...rows]
  const sign = sort.dir === 'asc' ? 1 : -1
  const missing = column.missing
  return [...rows].sort((a, b) => {
    if (missing) {
      const aMissing = missing(a)
      if (aMissing !== missing(b)) return aMissing ? 1 : -1
    }
    return sign * compare(a, b) || (tieBreak ? tieBreak(a, b) : 0)
  })
}
