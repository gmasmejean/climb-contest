/**
 * Même vocabulaire que l'écran juge (`JudgeAscentEntry.vue`) — dupliqué
 * plutôt qu'extrait en composant partagé : quatre lignes, pas assez pour
 * justifier un couplage entre l'écran juge et la page publique.
 */
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
