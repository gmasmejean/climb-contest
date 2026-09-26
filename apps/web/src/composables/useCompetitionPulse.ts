import type { DashboardResponse } from '@climbcontest/contracts'
import type { TabBadge } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'

import { competitionsApi } from '../api/competitions'
import { dashboardApi } from '../api/dashboard'

/**
 * Le pouls d'une compétition : ce que la page compétition doit savoir en
 * permanence, quel que soit l'onglet ouvert (ROADMAP.md Lot 20).
 *
 * Il réutilise les clés de cache EXISTANTES (`dashboard`, `readiness`) : les
 * écrans qui les interrogeaient déjà partagent la même requête avec celle-ci,
 * TanStack n'en émet pas une seconde. C'est aussi le seul endroit où la
 * cadence de sondage est décidée — avant ce lot elle vivait dans
 * `PilotageOverview`, donc quitter « Vue d'ensemble » arrêtait tout
 * rafraîchissement sans que rien ne le dise.
 */
const POLL_INTERVAL_MS = 8000

export interface CompetitionPulse {
  dashboard: ComputedRef<DashboardResponse | undefined>
  /** Le serveur a échoué alors qu'on affiche encore d'anciens chiffres. */
  isStale: ComputedRef<boolean>
  /** Heure du dernier succès, en toutes lettres. `null` si rien n'est arrivé. */
  lastUpdate: ComputedRef<string | null>
  conflictCount: ComputedRef<number>
  alertCount: ComputedRef<number>
  blockingCount: ComputedRef<number>
  done: ComputedRef<number>
  expected: ComputedRef<number>
  /** Pastille de l'onglet Pilotage, `undefined` s'il n'y a rien à signaler. */
  pilotageBadge: ComputedRef<TabBadge | undefined>
  /** Pastille de l'onglet « Prêt à démarrer ? ». */
  readinessBadge: ComputedRef<TabBadge | undefined>
  refetch: () => Promise<void>
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count > 1 ? 's' : ''}`
}

export function useCompetitionPulse(
  competitionId: MaybeRefOrGetter<string>,
  options: {
    /** Compétition en cours, ou onglet Pilotage ouvert : on sonde. Sinon, une seule lecture. */
    live: MaybeRefOrGetter<boolean>
  },
): CompetitionPulse {
  const id = computed(() => toValue(competitionId))

  const dashboardQuery = useQuery({
    queryKey: ['competitions', id, 'dashboard'],
    queryFn: () => dashboardApi.get(id.value),
    refetchInterval: computed(() => (toValue(options.live) ? POLL_INTERVAL_MS : false)),
    // Une seule relance avant d'avertir : par défaut TanStack en fait trois,
    // avec repli, et l'organisateur regarderait des chiffres périmés pendant
    // près de dix secondes sans le savoir.
    retry: 1,
  })

  const readinessQuery = useQuery({
    queryKey: ['competitions', id, 'readiness'],
    queryFn: () => competitionsApi.readiness(id.value),
    refetchOnWindowFocus: true,
  })

  const dashboard = computed(() => dashboardQuery.data.value)

  const conflictCount = computed(
    () =>
      dashboard.value?.alerts.filter((alert) => alert.type === 'unresolved_conflict').length ?? 0,
  )
  const alertCount = computed(() => dashboard.value?.alerts.length ?? 0)
  const blockingCount = computed(
    () => readinessQuery.data.value?.checks.filter((check) => !check.ok).length ?? 0,
  )

  const totals = computed(() => {
    let done = 0
    let expected = 0
    for (const category of dashboard.value?.categories ?? []) {
      for (const route of category.routes) {
        done += route.done
        expected += route.expected
      }
    }
    return { done, expected }
  })

  return {
    dashboard,
    isStale: computed(() => dashboardQuery.isError.value && dashboard.value !== undefined),
    lastUpdate: computed(() =>
      dashboardQuery.dataUpdatedAt.value
        ? new Date(dashboardQuery.dataUpdatedAt.value).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null,
    ),
    conflictCount,
    alertCount,
    blockingCount,
    done: computed(() => totals.value.done),
    expected: computed(() => totals.value.expected),
    /*
     * Un conflit retient une publication : il passe devant une alerte, qui
     * n'est qu'un signal. Une seule pastille par onglet — deux compteurs côte
     * à côte dans une barre latérale de 15 rem ne se lisent plus.
     */
    pilotageBadge: computed(() => {
      if (conflictCount.value > 0) {
        return {
          count: conflictCount.value,
          label: plural(conflictCount.value, 'conflit'),
          tone: 'danger' as const,
        }
      }
      if (alertCount.value > 0) {
        return {
          count: alertCount.value,
          label: plural(alertCount.value, 'alerte'),
          tone: 'warning' as const,
        }
      }
      return undefined
    }),
    readinessBadge: computed(() =>
      blockingCount.value > 0
        ? {
            count: blockingCount.value,
            label: `${plural(blockingCount.value, 'point')} à corriger`,
            tone: 'warning' as const,
          }
        : undefined,
    ),
    refetch: async () => {
      await dashboardQuery.refetch()
    },
  }
}
