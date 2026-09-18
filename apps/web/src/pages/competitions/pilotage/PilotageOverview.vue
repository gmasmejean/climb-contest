<script setup lang="ts">
import type { DashboardAlert } from '@climbcontest/contracts'
import { Badge } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'

import { dashboardApi } from '../../../api/dashboard'

const props = defineProps<{ competitionId: string }>()

// Polling plutôt que SSE (décidé avec l'utilisateur, DECISIONS.md) : ce
// tableau de bord n'a pas besoin d'un temps réel à la seconde près, et
// réutilise l'authentification JWT organisateur déjà en place.
const { data, isPending } = useQuery({
  queryKey: ['competitions', props.competitionId, 'dashboard'],
  queryFn: () => dashboardApi.get(props.competitionId),
  refetchInterval: 8000,
})

function alertLabel(alert: DashboardAlert): string {
  switch (alert.type) {
    case 'route_stalled':
      return 'Voie sans saisie depuis plus de 15 minutes'
    case 'judge_silent':
      return 'Juge muet depuis plus de 10 minutes'
    case 'unresolved_conflict':
      return 'Conflit de saisie non résolu'
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
</script>

<template>
  <div class="flex flex-col gap-6">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <template v-else-if="data">
      <section v-if="data.alerts.length > 0" class="flex flex-col gap-2">
        <h2 class="font-medium text-gray-900">Alertes</h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="(alert, index) in data.alerts"
            :key="index"
            class="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
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
        <div
          v-for="cat in data.categories"
          :key="cat.categoryId"
          class="rounded-lg border border-gray-200 p-4"
        >
          <h3 class="font-medium text-gray-900">{{ cat.label }}</h3>
          <ul class="mt-2 flex flex-col gap-1">
            <li
              v-for="r in cat.routes"
              :key="`${r.roundId}-${r.routeId}`"
              class="flex items-center justify-between text-sm text-gray-700"
            >
              <span>Voie {{ r.number }}<span v-if="r.name"> — {{ r.name }}</span></span>
              <span>{{ r.done }} / {{ r.expected }}</span>
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

      <section class="flex flex-col gap-2">
        <h2 class="font-medium text-gray-900">Juges</h2>
        <ul class="flex flex-col gap-2">
          <li
            v-for="j in data.judges"
            :key="j.judgeId"
            class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3"
          >
            <span class="font-medium text-gray-900">{{ j.displayName }}</span>
            <span class="text-sm text-gray-600">
              {{ j.ascentCount }} saisie(s) —
              {{ j.lastSeenAt ? `vu à ${new Date(j.lastSeenAt).toLocaleTimeString('fr-FR')}` : 'jamais vu' }}
            </span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
