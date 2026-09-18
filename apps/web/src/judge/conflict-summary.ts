/**
 * `BatchResultItem.existing`/`incoming` (packages/sync) sont typés `unknown`
 * côté paquet pur (ADR-014 : aucune dépendance à un contrat serveur précis).
 * Ce module fait le pont côté `apps/web`, qui SAIT que ces valeurs viennent
 * de `judgeAscentBatchResultSchema` (un `Ascent` complet) : réduit à la forme
 * minimale affichable, écrite explicitement à l'endroit où le type est
 * encore connu (`sync-transport.ts`), lue avec une garde de type explicite
 * (jamais un cast de confort) à l'endroit où il ne l'est plus.
 */
export interface AscentSummary {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
}

export function toAscentSummary(ascent: AscentSummary): AscentSummary {
  return {
    holdNumber: ascent.holdNumber,
    modifier: ascent.modifier,
    isTop: ascent.isTop,
    status: ascent.status,
  }
}

export function isAscentSummary(value: unknown): value is AscentSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'holdNumber' in value &&
    'modifier' in value &&
    'isTop' in value &&
    'status' in value
  )
}
