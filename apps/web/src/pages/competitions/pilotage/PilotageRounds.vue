<script setup lang="ts">
import { ROUND_STATUS_TRANSITIONS, type RoundStatus } from '@climbcontest/contracts'
import { Badge, Button, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'

import { ApiError } from '../../../api/client'
import { roundsApi } from '../../../api/competitions'
import { dashboardApi } from '../../../api/dashboard'
import PilotageRoundQualifiers from './PilotageRoundQualifiers.vue'

const props = defineProps<{ competitionId: string; format: 'contest' | 'phases' }>()

const toast = useToast()
const queryClient = useQueryClient()
const dashboardKey = ['competitions', props.competitionId, 'dashboard']

// Le tableau de bord donne déjà chaque (roundId, catégorie, roundStatus) via
// ses voies — une seule source, valable pour les deux formats (le tour
// implicite du contest n'a pas d'écran « Tours » propre, ADR-023).
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
// Actions groupées : on ne propose pas « Repasser en brouillon » pour toutes les
// catégories d'un coup — c'est une sortie de secours, catégorie par catégorie.
const BULK_TARGETS: RoundStatus[] = ['open', 'closed', 'published']

interface CategoryState {
  categoryId: string
  label: string
  status: RoundStatus
}

// ADR-065 : le statut d'un tour se porte par catégorie (les U16 peuvent avoir
// fini le matin quand les U18 n'ont pas commencé).
const rounds = computed(() => {
  if (!dashboard.value) return []
  const byRound = new Map<string, CategoryState[]>()
  for (const cat of dashboard.value.categories) {
    for (const r of cat.routes) {
      if (!r.roundId || !r.roundStatus) continue
      const states = byRound.get(r.roundId) ?? []
      if (!states.some((s) => s.categoryId === cat.categoryId)) {
        states.push({ categoryId: cat.categoryId, label: cat.label, status: r.roundStatus })
      }
      byRound.set(r.roundId, states)
    }
  }
  return [...byRound.entries()]
    .map(([roundId, categories]) => {
      const phaseRound = phaseRounds.value?.find((r) => r.id === roundId)
      return {
        roundId,
        categories,
        label: phaseRound ? (ROUND_TYPE_LABELS[phaseRound.type] ?? phaseRound.type) : 'Résultats',
        order: phaseRound?.displayOrder ?? 0,
        // Change dès qu'une catégorie change d'état : relit la liste des qualifiés.
        statusKey: categories.map((c) => `${c.categoryId}:${c.status}`).join('|'),
      }
    })
    .sort((a, b) => a.order - b.order)
})

/** Les catégories d'un tour à qui la transition vers `target` est permise. */
function eligible(categories: CategoryState[], target: RoundStatus): CategoryState[] {
  return categories.filter((c) => ROUND_STATUS_TRANSITIONS[c.status].includes(target))
}

const changeStatusMutation = useMutation({
  mutationFn: (input: { roundId: string; status: RoundStatus; categoryIds: string[] }) =>
    roundsApi.changeStatus(props.competitionId, input.roundId, {
      status: input.status,
      categoryIds: input.categoryIds,
    }),
  onSuccess: async () => {
    // Ouvrir une catégorie fait démarrer la compétition : le statut affiché dans Infos change aussi.
    await queryClient.invalidateQueries({ queryKey: ['competitions', props.competitionId] })
    await queryClient.invalidateQueries({ queryKey: dashboardKey })
    toast.show('Statut mis à jour.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Transition impossible.',
      'error',
    )
  },
})

function change(roundId: string, status: RoundStatus, categories: CategoryState[]): void {
  changeStatusMutation.mutate({ roundId, status, categoryIds: categories.map((c) => c.categoryId) })
}
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
        class="flex flex-col gap-3 rounded-lg border border-gray-200 p-4"
        :data-testid="`round-${r.roundId}`"
      >
        <h3 class="font-medium text-gray-900">{{ r.label }}</h3>

        <ul class="flex flex-col gap-3">
          <li
            v-for="cat in r.categories"
            :key="cat.categoryId"
            class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            :data-testid="`round-${r.roundId}-category-${cat.categoryId}`"
          >
            <div class="flex items-center gap-2">
              <span class="text-gray-900">{{ cat.label }}</span>
              <Badge :tone="STATUS_TONES[cat.status]">{{ STATUS_LABELS[cat.status] }}</Badge>
            </div>
            <div class="flex flex-wrap gap-2">
              <Button
                v-for="target in ROUND_STATUS_TRANSITIONS[cat.status]"
                :key="target"
                variant="secondary"
                :disabled="changeStatusMutation.isPending.value"
                :aria-label="`${ACTION_LABELS[target]} — ${cat.label}`"
                @click="change(r.roundId, target, [cat])"
              >
                {{ ACTION_LABELS[target] }}
              </Button>
            </div>
          </li>
        </ul>

        <div
          v-if="BULK_TARGETS.some((target) => eligible(r.categories, target).length >= 2)"
          class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3"
        >
          <span class="text-sm text-gray-700">Plusieurs catégories d'un coup :</span>
          <template v-for="target in BULK_TARGETS" :key="target">
            <Button
              v-if="eligible(r.categories, target).length >= 2"
              variant="secondary"
              :disabled="changeStatusMutation.isPending.value"
              @click="change(r.roundId, target, eligible(r.categories, target))"
            >
              {{ ACTION_LABELS[target] }} ({{ eligible(r.categories, target).length }} catégories)
            </Button>
          </template>
        </div>

        <PilotageRoundQualifiers
          v-if="props.format === 'phases'"
          :competition-id="props.competitionId"
          :round-id="r.roundId"
          :status-key="r.statusKey"
        />
      </li>
    </ul>
  </div>
</template>
