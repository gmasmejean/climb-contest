<script setup lang="ts">
import { Badge, Button, Modal, NumberField, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { dashboardApi } from '../../../api/dashboard'
import { organizerAscentsApi, type RouteAscentEntry } from '../../../api/organizer-ascents'

const props = defineProps<{ competitionId: string }>()

const toast = useToast()
const queryClient = useQueryClient()

const { data: dashboard } = useQuery({
  queryKey: ['competitions', props.competitionId, 'dashboard'],
  queryFn: () => dashboardApi.get(props.competitionId),
})

const routeOptions = computed(() => {
  if (!dashboard.value) return []
  const seen = new Map<string, { value: string; label: string; roundId: string; routeId: string }>()
  for (const cat of dashboard.value.categories) {
    for (const r of cat.routes) {
      const key = `${r.roundId}:${r.routeId}`
      if (!seen.has(key)) {
        seen.set(key, {
          value: key,
          label: `Voie ${r.number}${r.name ? ` — ${r.name}` : ''} (${cat.label})`,
          roundId: r.roundId ?? '',
          routeId: r.routeId,
        })
      }
    }
  }
  return [...seen.values()]
})

const selectedKey = ref('')
const selected = computed(() => routeOptions.value.find((o) => o.value === selectedKey.value) ?? null)

const listKey = computed(() => [
  'competitions',
  props.competitionId,
  'ascents',
  selected.value?.roundId,
  selected.value?.routeId,
])
const { data: entries, isPending } = useQuery({
  queryKey: listKey,
  queryFn: () =>
    organizerAscentsApi.listForRoute(
      props.competitionId,
      selected.value!.roundId,
      selected.value!.routeId,
    ),
  enabled: computed(() => selected.value !== null),
})

function summarize(a: RouteAscentEntry['ascent']): string {
  if (!a) return '—'
  if (a.status === 'dns') return 'DNS'
  if (a.status === 'dnf') return 'DNF'
  if (a.status === 'dsq') return 'DSQ'
  if (a.isTop) return 'TOP'
  return `prise ${a.holdNumber}${a.modifier === 'plus' ? '+' : ''}`
}

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Validé' },
  { value: 'dns', label: 'DNS — absent' },
  { value: 'dnf', label: 'DNF — abandon en cours' },
  { value: 'dsq', label: 'DSQ — disqualifié' },
]
const MODIFIER_OPTIONS = [
  { value: 'none', label: 'Neutre' },
  { value: 'plus', label: '+' },
]

interface EditState {
  mode: 'create' | 'correct'
  competitorId: string
  ascentId: string | null
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  reason: string
}
const editing = ref<EditState | null>(null)
const editError = ref('')

function openCreate(entry: RouteAscentEntry): void {
  editError.value = ''
  editing.value = {
    mode: 'create',
    competitorId: entry.id,
    ascentId: null,
    holdNumber: null,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    reason: '',
  }
}
function openCorrect(entry: RouteAscentEntry): void {
  if (!entry.ascent) return
  editError.value = ''
  editing.value = {
    mode: 'correct',
    competitorId: entry.id,
    ascentId: entry.ascent.id,
    holdNumber: entry.ascent.holdNumber,
    modifier: entry.ascent.modifier,
    isTop: entry.ascent.isTop,
    status: entry.ascent.status,
    reason: '',
  }
}
function closeEdit(): void {
  editing.value = null
}

async function refreshList(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: listKey.value })
}

const submitMutation = useMutation({
  mutationFn: async () => {
    const state = editing.value
    if (!state || !selected.value) throw new Error('Aucune saisie en cours.')
    const shape = {
      holdNumber: state.isTop || state.status !== 'valid' ? null : state.holdNumber,
      modifier: state.modifier,
      isTop: state.status === 'valid' && state.isTop,
      status: state.status,
    }
    if (state.mode === 'create') {
      return organizerAscentsApi.create(props.competitionId, {
        roundId: selected.value.roundId,
        routeId: selected.value.routeId,
        competitorId: state.competitorId,
        recordedAt: new Date().toISOString(),
        ...shape,
      })
    }
    return organizerAscentsApi.correct(props.competitionId, state.ascentId!, {
      ...shape,
      reason: state.reason,
    })
  },
  onSuccess: async (result) => {
    editing.value = null
    await refreshList()
    if ('status' in result && result.status === 'conflict') {
      toast.show(
        'Un autre appareil a déjà saisi une valeur différente — un conflit a été créé, à résoudre depuis l’onglet Conflits.',
        'error',
      )
      return
    }
    toast.show('Passage enregistré.', 'success')
  },
  onError: (error) => {
    editError.value =
      error instanceof ApiError ? (error.detail ?? error.title) : 'Une erreur inattendue est survenue.'
  },
})

const editFormComputed = computed(() => editing.value as EditState)
</script>

<template>
  <div class="flex flex-col gap-4">
    <Select v-model="selectedKey" label="Tour et voie" :options="[{ value: '', label: 'Choisir…' }, ...routeOptions]" />

    <p v-if="selected && isPending" class="text-gray-600">Chargement…</p>
    <ul v-else-if="selected && entries" class="flex flex-col gap-2">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <span class="font-medium text-gray-900"
            >{{ entry.bib ?? '—' }} — {{ entry.firstName }} {{ entry.lastName }}</span
          >
          <p class="text-sm text-gray-600">
            {{ entry.categoryLabel }} —
            <Badge :tone="entry.ascent ? 'success' : 'neutral'">{{ summarize(entry.ascent) }}</Badge>
          </p>
        </div>
        <Button v-if="entry.ascent" variant="secondary" @click="openCorrect(entry)">Corriger</Button>
        <Button v-else variant="secondary" @click="openCreate(entry)">Saisir (secours)</Button>
      </li>
      <li v-if="entries.length === 0" class="text-gray-600">Aucun compétiteur pour cette voie.</li>
    </ul>

    <Modal
      :open="editing !== null"
      :title="editFormComputed?.mode === 'correct' ? 'Corriger le passage' : 'Saisie de secours'"
      @close="closeEdit"
    >
      <form v-if="editing" class="flex flex-col gap-4" @submit.prevent="submitMutation.mutate()">
        <Select v-model="editing.status" label="Statut" :options="STATUS_OPTIONS" required />
        <template v-if="editing.status === 'valid'">
          <label class="flex min-h-12 items-center gap-2">
            <input v-model="editing.isTop" type="checkbox" class="h-5 w-5 rounded border-gray-400" />
            <span class="text-sm text-gray-900">TOP</span>
          </label>
          <template v-if="!editing.isTop">
            <NumberField v-model="editing.holdNumber" label="Numéro de prise" :min="1" required />
            <Select v-model="editing.modifier" label="Modificateur" :options="MODIFIER_OPTIONS" />
          </template>
        </template>
        <TextField
          v-if="editing.mode === 'correct'"
          v-model="editing.reason"
          label="Motif (obligatoire)"
          required
        />
        <p v-if="editError" role="alert" class="text-sm text-red-700">{{ editError }}</p>
        <div class="flex gap-2">
          <Button type="submit" :disabled="submitMutation.isPending.value">
            {{ submitMutation.isPending.value ? 'Enregistrement…' : 'Enregistrer' }}
          </Button>
          <Button type="button" variant="secondary" @click="closeEdit">Annuler</Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
