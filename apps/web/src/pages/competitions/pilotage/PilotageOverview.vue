<script setup lang="ts">
import type { DashboardAlert, DashboardResponse } from '@climbcontest/contracts'
import { Badge, Button, ProgressBar } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

import { competitorsApi, routesApi } from '../../../api/competitions'
import { dashboardApi } from '../../../api/dashboard'
import type { CompetitionPulse } from '../../../composables/useCompetitionPulse'
import { UNREACHABLE_MESSAGE } from '../../../lib/network-errors'

// Le sondage et le bandeau « serveur injoignable » vivent un cran au-dessus
// (Lot 20) : ils valent pour les cinq sections du pilotage, pas pour cette
// seule vue. Polling et non SSE reste la décision d'ADR-045.
const props = defineProps<{ competitionId: string; pulse: CompetitionPulse }>()

const emit = defineEmits<{ open: [section: string] }>()

const data = computed(() => props.pulse.dashboard.value)
const isPending = computed(() => data.value === undefined && !props.pulse.isStale.value)

/* --- Panneau Conflits ------------------------------------------------- */

const conflictAlerts = computed(() =>
  (data.value?.alerts ?? []).filter(
    (alert): alert is Extract<DashboardAlert, { type: 'unresolved_conflict' }> =>
      alert.type === 'unresolved_conflict',
  ),
)

// Nommer le compétiteur et la voie, comme l'onglet Conflits depuis le Lot 21 :
// un compte seul ne dit pas s'il s'agit du dossard 12 ou du 47. Mêmes clés de
// cache que les onglets de préparation, et rien n'est demandé tant qu'il n'y a
// aucun conflit.
const hasConflicts = computed(() => conflictAlerts.value.length > 0)
const { data: competitors } = useQuery({
  queryKey: ['competitions', props.competitionId, 'competitors'],
  queryFn: () => competitorsApi.list(props.competitionId),
  enabled: hasConflicts,
})
const { data: routes } = useQuery({
  queryKey: ['competitions', props.competitionId, 'routes'],
  queryFn: () => routesApi.list(props.competitionId),
  enabled: hasConflicts,
})
const competitorLabels = computed(
  () =>
    new Map(
      (competitors.value ?? []).map((c) => [
        c.id,
        `${c.bib !== null ? `Dossard ${c.bib} — ` : ''}${c.firstName} ${c.lastName}`,
      ]),
    ),
)
const routeLabels = computed(
  () => new Map((routes.value ?? []).map((r) => [r.id, `Voie ${r.number}`])),
)

/* --- Panneau Journal --------------------------------------------------- */

const ACTIVITY_LABELS: Record<string, string> = {
  round_status_changed: 'Statut du tour',
  competitor_status_changed: 'Statut du compétiteur',
  ascent_created: 'Passage saisi',
  ascent_corrected: 'Passage corrigé',
  ascent_voided: 'Passage annulé',
  conflict_resolved: 'Conflit résolu',
}
// Même clé (et donc même cache) que l'onglet Journal sans filtre.
const { data: activity } = useQuery({
  queryKey: ['competitions', props.competitionId, 'activity-log', {}],
  queryFn: () => dashboardApi.activityLog(props.competitionId),
})
const recentActivity = computed(() => (activity.value?.entries ?? []).slice(0, 5))

/* --- Progression ------------------------------------------------------- */

function categoryTotals(category: DashboardResponse['categories'][number]): {
  done: number
  expected: number
} {
  return category.routes.reduce(
    (total, route) => ({
      done: total.done + route.done,
      expected: total.expected + route.expected,
    }),
    { done: 0, expected: 0 },
  )
}

function routeLabel(route: DashboardResponse['categories'][number]['routes'][number]): string {
  return `Voie ${route.number}${route.name ? ` — ${route.name}` : ''}`
}

/* --- Alertes ----------------------------------------------------------- */

function alertLabel(alert: DashboardAlert): string {
  switch (alert.type) {
    case 'route_stalled':
      return 'Voie sans saisie depuis plus de 15 minutes'
    case 'judge_silent':
      return 'Juge muet depuis plus de 10 minutes'
    case 'unresolved_conflict':
      // Lot 21 (ADR-078) : couvre aussi une saisie d'accès révoqué en attente.
      return 'Saisie à trancher dans l’onglet Conflits'
    case 'competitor_no_ascent':
      return 'Compétiteur sans aucun passage alors que le tour est fermé'
  }
}
function alertDetail(alert: DashboardAlert): string {
  switch (alert.type) {
    case 'route_stalled':
      return `Voie ${alert.routeNumber}`
    case 'judge_silent':
      return alert.judgeDisplayName
    case 'competitor_no_ascent':
      return `Dossard ${alert.bib ?? '—'} — ${alert.firstName} ${alert.lastName}`
    case 'unresolved_conflict':
      return ''
  }
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const panelClass = 'rounded-lg border border-gray-200 bg-white p-4'
</script>

<template>
  <div>
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <div v-else-if="!data" role="alert" class="flex flex-col items-start gap-3">
      <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
      <Button variant="secondary" @click="pulse.refetch">Réessayer</Button>
    </div>

    <!--
      Poste de pilotage (Lot 20) : à partir de `lg`, ce qu'on surveille et ce
      qu'on doit trancher tiennent sur le même écran. Le rail de droite est
      collant SANS conteneur de défilement — un `overflow-y-auto` décrocherait
      les en-têtes collants des tableaux (ADR-074 point 9).
      Une seule mise en page responsive, un seul arbre dans le DOM.
    -->
    <div
      v-else
      class="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8"
      data-testid="pilotage-overview"
    >
      <div class="flex min-w-0 flex-col gap-6">
        <section v-if="data.alerts.length > 0" class="flex flex-col gap-2">
          <h2 class="font-medium text-gray-900">Alertes</h2>
          <ul class="flex flex-col gap-2">
            <li
              v-for="(alert, index) in data.alerts"
              :key="index"
              class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
            >
              <Badge tone="warning">{{ alertLabel(alert) }}</Badge>
              <span class="text-sm text-gray-800">{{ alertDetail(alert) }}</span>
            </li>
          </ul>
        </section>
        <p v-else class="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
          Aucune alerte pour l'instant.
        </p>

        <section class="flex flex-col gap-3">
          <h2 class="font-medium text-gray-900">Progression par catégorie</h2>
          <div v-for="cat in data.categories" :key="cat.categoryId" :class="panelClass">
            <h3 class="font-medium text-gray-900">{{ cat.label }}</h3>
            <div class="mt-2">
              <ProgressBar
                :value="categoryTotals(cat).done"
                :max="categoryTotals(cat).expected"
                :label="`${cat.label} — total`"
                label-hidden
              />
            </div>
            <ul class="mt-3 flex flex-col gap-2">
              <li v-for="r in cat.routes" :key="`${r.roundId}-${r.routeId}`">
                <ProgressBar :value="r.done" :max="r.expected" :label="routeLabel(r)" />
              </li>
              <li v-if="cat.routes.length === 0" class="text-sm text-gray-600">
                Aucune voie dans cette catégorie.
              </li>
            </ul>
          </div>
        </section>

        <section v-if="data.competitorsPending.length > 0" class="flex flex-col gap-2">
          <h2 class="font-medium text-gray-900">
            Compétiteurs n'ayant pas encore grimpé ({{ data.competitorsPending.length }})
          </h2>
          <ul class="flex flex-col gap-1 text-sm text-gray-700">
            <li v-for="c in data.competitorsPending" :key="c.competitorId">
              Dossard {{ c.bib ?? '—' }} — {{ c.firstName }} {{ c.lastName }} : voies restantes
              {{ c.remainingRouteNumbers.join(', ') }}
            </li>
          </ul>
        </section>
      </div>

      <div class="flex flex-col gap-6 lg:sticky lg:top-24">
        <section :class="panelClass" data-testid="panel-conflicts">
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-medium text-gray-900">Conflits</h2>
            <Badge :tone="hasConflicts ? 'danger' : 'success'">{{ conflictAlerts.length }}</Badge>
          </div>
          <template v-if="hasConflicts">
            <ul class="mt-2 flex flex-col gap-1 text-sm text-gray-700">
              <li v-for="alert in conflictAlerts.slice(0, 3)" :key="alert.conflictGroup">
                {{ competitorLabels.get(alert.competitorId) ?? 'Compétiteur' }} —
                {{ routeLabels.get(alert.routeId) ?? 'voie' }}
              </li>
            </ul>
            <p v-if="conflictAlerts.length > 3" class="mt-1 text-sm text-gray-600">
              et {{ conflictAlerts.length - 3 }} de plus.
            </p>
            <div class="mt-3">
              <Button variant="secondary" @click="emit('open', 'conflicts')">Trancher</Button>
            </div>
          </template>
          <p v-else class="mt-2 text-sm text-gray-600">
            Rien à trancher. Un conflit retient la publication d'un classement.
          </p>
        </section>

        <section :class="panelClass" data-testid="panel-judges">
          <h2 class="font-medium text-gray-900">Juges</h2>
          <ul class="mt-2 flex flex-col gap-2">
            <li
              v-for="j in data.judges"
              :key="j.judgeId"
              class="flex flex-col gap-0.5 text-sm text-gray-700"
            >
              <span class="font-medium text-gray-900">
                {{ j.displayName }}
                <span v-if="j.revokedAt" class="font-normal text-red-700">— accès révoqué</span>
              </span>
              <span>
                {{ j.ascentCount }} saisie(s) —
                {{ j.lastSeenAt ? `vu à ${time(j.lastSeenAt)}` : 'jamais vu' }}
              </span>
            </li>
            <li v-if="data.judges.length === 0" class="text-sm text-gray-600">
              Aucun juge déclaré.
            </li>
          </ul>
        </section>

        <section :class="panelClass" data-testid="panel-activity">
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-medium text-gray-900">Dernières actions</h2>
            <button
              type="button"
              class="min-h-12 text-sm font-medium text-blue-700 hover:underline lg:min-h-0"
              @click="emit('open', 'activity-log')"
            >
              Tout le journal
            </button>
          </div>
          <ul class="mt-2 flex flex-col gap-2">
            <li v-for="entry in recentActivity" :key="entry.id" class="text-sm text-gray-700">
              <span class="text-gray-500">{{ time(entry.createdAt) }}</span>
              — {{ ACTIVITY_LABELS[entry.type] ?? entry.type }}
              <span v-if="entry.actorLabel" class="text-gray-600">({{ entry.actorLabel }})</span>
            </li>
            <li v-if="recentActivity.length === 0" class="text-sm text-gray-600">
              Aucune activité pour l'instant.
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
