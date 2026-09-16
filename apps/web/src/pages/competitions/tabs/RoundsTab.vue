<script setup lang="ts">
import { createRoundInputSchema } from '@climbcontest/contracts'
import { Button, NumberField, Select } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, roundsApi, routesApi } from '../../../api/competitions'
import RoundRoutesPanel from '../RoundRoutesPanel.vue'

const props = defineProps<{ competitionId: string }>()

const queryClient = useQueryClient()
const roundsKey = ['competitions', props.competitionId, 'rounds']

const { data: rounds, isPending } = useQuery({
  queryKey: roundsKey,
  queryFn: () => roundsApi.list(props.competitionId),
})
const { data: routes } = useQuery({
  queryKey: ['competitions', props.competitionId, 'routes'],
  queryFn: () => routesApi.list(props.competitionId),
})
const { data: categories } = useQuery({
  queryKey: ['competitions', props.competitionId, 'categories'],
  queryFn: () => categoriesApi.list(props.competitionId),
})

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: roundsKey })
}

const typeOptions = [
  { value: 'qualification', label: 'Qualification' },
  { value: 'semifinal', label: 'Demi-finale' },
  { value: 'final', label: 'Finale' },
]
const styleOptions = [
  { value: 'flash', label: 'Flash' },
  { value: 'onsight', label: 'À vue' },
]

function emptyForm() {
  return {
    type: 'qualification' as 'qualification' | 'semifinal' | 'final',
    style: 'flash' as 'flash' | 'onsight',
    qualifyingCount: null as number | null,
  }
}
const form = reactive(emptyForm())
const editingRoundId = ref<string | null>(null)
const formError = ref('')

const { mutate: createRound, isPending: isCreating } = useMutation({
  mutationFn: () => roundsApi.create(props.competitionId, { ...form }),
  onSuccess: async () => {
    Object.assign(form, emptyForm())
    await refresh()
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

const { mutate: updateRound, isPending: isUpdating } = useMutation({
  mutationFn: () => roundsApi.update(props.competitionId, editingRoundId.value ?? '', { ...form }),
  onSuccess: async () => {
    Object.assign(form, emptyForm())
    editingRoundId.value = null
    await refresh()
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onSubmit(): void {
  formError.value = ''
  const result = createRoundInputSchema.safeParse(form)
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  if (editingRoundId.value) updateRound()
  else createRound()
}

function startEdit(round: {
  id: string
  type: 'qualification' | 'semifinal' | 'final'
  style: 'flash' | 'onsight'
  qualifyingCount: number | null
}): void {
  editingRoundId.value = round.id
  form.type = round.type
  form.style = round.style
  form.qualifyingCount = round.qualifyingCount
}
function cancelEdit(): void {
  editingRoundId.value = null
  Object.assign(form, emptyForm())
}

const { mutate: reorder } = useMutation({
  mutationFn: (orderedIds: string[]) => roundsApi.reorder(props.competitionId, orderedIds),
  onSuccess: async () => refresh(),
})
function move(index: number, delta: number): void {
  if (!rounds.value) return
  const target = index + delta
  if (target < 0 || target >= rounds.value.length) return
  const ids = rounds.value.map((r) => r.id)
  const [moved] = ids.splice(index, 1)
  if (moved === undefined) return
  ids.splice(target, 0, moved)
  reorder(ids)
}

const pairs = computed(() => {
  if (!routes.value || !categories.value) return []
  return routes.value.flatMap((route) =>
    route.categoryIds.map((categoryId) => ({
      routeId: route.id,
      categoryId,
      label: `Voie ${route.number} — ${categories.value?.find((c) => c.id === categoryId)?.label ?? '?'}`,
    })),
  )
})

const expandedRoundId = ref<string | null>(null)
</script>

<template>
  <div class="flex flex-col gap-6">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="(round, index) in rounds"
        :key="round.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3"
      >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span class="font-medium text-gray-900">
              {{ typeOptions.find((o) => o.value === round.type)?.label }}
            </span>
            <p class="text-sm text-gray-600">
              {{ styleOptions.find((o) => o.value === round.style)?.label }}
              <span v-if="round.qualifyingCount"> · {{ round.qualifyingCount }} qualifiés</span>
            </p>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              aria-label="Monter"
              class="min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
              :disabled="index === 0"
              @click="move(index, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Descendre"
              class="min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
              :disabled="!rounds || index === rounds.length - 1"
              @click="move(index, 1)"
            >
              ↓
            </button>
            <Button variant="secondary" @click="startEdit(round)">Modifier</Button>
            <Button
              variant="secondary"
              @click="expandedRoundId = expandedRoundId === round.id ? null : round.id"
            >
              {{ expandedRoundId === round.id ? 'Masquer les voies' : 'Gérer les voies' }}
            </Button>
          </div>
        </div>
        <RoundRoutesPanel
          v-if="expandedRoundId === round.id"
          :competition-id="competitionId"
          :round-id="round.id"
          :pairs="pairs"
        />
      </li>
      <li v-if="rounds && rounds.length === 0" class="text-gray-600">Aucun tour.</li>
    </ul>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
      @submit.prevent="onSubmit"
    >
      <h2 class="font-medium text-gray-900">
        {{ editingRoundId ? 'Modifier le tour' : 'Ajouter un tour' }}
      </h2>
      <div class="grid grid-cols-3 gap-4">
        <Select v-model="form.type" label="Type" :options="typeOptions" required />
        <Select v-model="form.style" label="Style" :options="styleOptions" required />
        <NumberField v-model="form.qualifyingCount" label="Qualifiés (optionnel)" :min="1" />
      </div>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <div class="flex gap-3">
        <Button type="submit" :disabled="isCreating || isUpdating">
          {{ editingRoundId ? 'Enregistrer' : 'Ajouter' }}
        </Button>
        <Button v-if="editingRoundId" variant="secondary" @click="cancelEdit">Annuler</Button>
      </div>
    </form>
  </div>
</template>
