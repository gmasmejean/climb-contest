import type { Competition } from '@climbcontest/contracts'
import type { TabBadge, TabItem } from '@climbcontest/ui'

/**
 * Onglets de la page compétition (ADR-072). L'identifiant est aussi le segment
 * d'URL : `/competitions/:id/:tab?`. `infos` est l'onglet par défaut, il n'a
 * pas de segment.
 */
const TABS = [
  { id: 'infos', label: 'Infos', group: 'Préparer' },
  { id: 'categories', label: 'Catégories', group: 'Préparer' },
  { id: 'competitors', label: 'Compétiteurs', group: 'Préparer' },
  { id: 'routes', label: 'Voies', group: 'Préparer' },
  { id: 'rounds', label: 'Tours', group: 'Préparer' },
  { id: 'judges', label: 'Juges', group: 'Préparer' },
  { id: 'readiness', label: 'Prêt à démarrer ?', group: 'Vérifier' },
  { id: 'pilotage', label: 'Pilotage', group: 'Jour J' },
  { id: 'exports', label: 'Exports', group: 'Jour J' },
] as const

type CompetitionTabDefinition = (typeof TABS)[number]
export type CompetitionTabId = CompetitionTabDefinition['id']

/** Un onglet prêt à passer à `Tabs`, pastille comprise (Lot 20). */
export interface CompetitionTab extends TabItem {
  id: CompetitionTabId
}

/** Pastilles par onglet. Une entrée absente = rien à signaler. */
export type CompetitionTabBadges = Partial<Record<CompetitionTabId, TabBadge | undefined>>

export const DEFAULT_COMPETITION_TAB: CompetitionTabId = 'infos'

export function isCompetitionTabId(value: unknown): value is CompetitionTabId {
  return TABS.some((tab) => tab.id === value)
}

/**
 * Les tours n'existent qu'au format à phases. `badges` décore les onglets sans
 * toucher à leur ordre ni à leurs libellés — la fonction reste pure, et c'est
 * l'appelant qui sait ce qu'il y a à compter.
 */
export function competitionTabs(
  format: Competition['format'] | undefined,
  badges: CompetitionTabBadges = {},
): CompetitionTab[] {
  return TABS.filter((tab) => tab.id !== 'rounds' || format === 'phases').map((tab) => {
    const badge = badges[tab.id]
    return badge === undefined ? { ...tab } : { ...tab, badge }
  })
}

/**
 * Onglet à afficher pour un segment d'URL. Tant que le format n'est pas connu
 * (`undefined`, compétition en cours de chargement) un segment valide est
 * gardé tel quel : on ne quitte pas `rounds` avant de savoir qu'il n'existe pas.
 */
export function resolveCompetitionTab(
  segment: unknown,
  format: Competition['format'] | undefined,
): CompetitionTabId {
  if (!isCompetitionTabId(segment)) return DEFAULT_COMPETITION_TAB
  if (segment === 'rounds' && format !== undefined && format !== 'phases') {
    return DEFAULT_COMPETITION_TAB
  }
  return segment
}
