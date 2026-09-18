<script setup lang="ts">
import { ROUND_STATUS_TRANSITIONS, type RoundStatus } from '@climbcontest/contracts'
import { Badge, Button, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'

import { ApiError } from '../../../api/client'
import { roundsApi } from '../../../api/competitions'
import { dashboardApi } from '../../../api/dashboard'

const props = defineProps<{ competitionId: string; format: 'contest' | 'phases' }>()

const toast = useToast()
const queryClient = useQueryClient()
const dashboardKey = ['competitions', props.competitionId, 'dashboard']

// Le tableau de bord donne déjà chaque (roundId, roundStatus) via ses voies —
// une seule source, valable pour les deux formats (le tour implicite du
// contest n'a pas d'écran « Tours » propre, ADR-023).
const { data: dashboard, isPending } = useQuery({
  queryKey: dashboardKey,
  queryFn: () => dashboardApi.get(props.competitionId),
})

const { data: phaseRounds } = useQuery({
  queryKey: ['competitions', props.competitionId, 'rounds'],
  queryFn: () => roundsApi.list(props.competitionId),
  enabled: props.format === 'phases',
})

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}
const STATUS_LABELS: Record<RoundStatus, string> = {
  draft: 'Brouillon',
  open: 'Ouvert',
  closed: 'Fermé',
  published: 'Publié',
}
const STATUS_TONES: Record<RoundStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'neutral',
  open: 'success',
  closed: 'warning',
  published: 'success',
}
const ACTION_LABELS: Record<RoundStatus, string> = {
  draft: 'Repasser en brouillon',
  open: 'Ouvrir',
  closed: 'Fermer',
  published: 'Publier les résultats',
}

const rounds = computed(() => {
  if (!dashboard.value) return []
  const byId = new Map<string, RoundStatus>()
  for (const cat of dashboard.value.categories) {
    for (const r of cat.routes) {
      if (r.roundId && r.roundStatus) byId.set(r.roundId, r.roundStatus)
    }
  }
  return [...byId.entries()].map(([roundId, status]) => {
    const phaseRound = phaseRounds.value?.find((r) => r.id === roundId)
    return {
      roundId,
      status,
      label: phaseRound ? (ROUND_TYPE_LABELS[phaseRound.type] ?? phaseRound.type) : 'Résultats',
    }
  })
})

const changeStatusMutation = useMutation({
  mutationFn: (input: { roundId: string; status: RoundStatus }) =>
    roundsApi.changeStatus(props.competitionId, input.roundId, { status: input.status }),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: dashboardKey })
    toast.show('Statut du tour mis à jour.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Transition impossible.',
      'error',
    )
  },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <p v-else-if="rounds.length === 0" class="text-gray-600">
      Aucun tour n'est encore configuré pour cette compétition.
    </p>
    <ul v-else class="flex flex-col gap-3">
      <li
        v-for="r in rounds"
        :key="r.roundId"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-2">
          <span class="font-medium text-gray-900">{{ r.label }}</span>
          <Badge :tone="STATUS_TONES[r.status]">{{ STATUS_LABELS[r.status] }}</Badge>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            v-for="target in ROUND_STATUS_TRANSITIONS[r.status]"
            :key="target"
            variant="secondary"
            :disabled="changeStatusMutation.isPending.value"
            @click="changeStatusMutation.mutate({ roundId: r.roundId, status: target })"
          >
            {{ ACTION_LABELS[target] }}
          </Button>
        </div>
      </li>
    </ul>
  </div>
</template>
