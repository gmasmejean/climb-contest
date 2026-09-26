<script setup lang="ts">
import { Badge, Button, Select, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { dashboardApi } from '../../../api/dashboard'
import { organizerAscentsApi, type RouteAscentEntry } from '../../../api/organizer-ascents'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'
import type { AscentEditTarget } from './ascent-edit'
import AscentEditDialog from './AscentEditDialog.vue'
import PilotageMatrix from './PilotageMatrix.vue'

const props = defineProps<{ competitionId: string }>()
const emit = defineEmits<{ open: [section: string] }>()

const toast = useToast()
const queryClient = useQueryClient()

// Même clé que le reste du pilotage : la requête est partagée, pas doublée.
const { data: dashboard } = useQuery({
  queryKey: ['competitions', props.competitionId, 'dashboard'],
  queryFn: () => dashboardApi.get(props.competitionId),
})

/*
 * À partir de `lg`, la grille compétiteurs × voies remplace le choix d'une
 * voie à la fois : c'est l'écran du portable de l'organisation (Lot 20). En
 * dessous, rien ne change (ADR-072 point 1). Un seul des deux est monté —
 * jamais deux arbres dont un masqué en CSS (ADR-074 point 2).
 */
const isDesktop = useMediaQuery(DESKTOP_QUERY)

/* --- Liste par voie (rendu du Lot 8, conservé sous `lg`) ---------------- */

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
const selected = computed(
  () => routeOptions.value.find((o) => o.value === selectedKey.value) ?? null,
)

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
  enabled: computed(() => selected.value !== null && !isDesktop.value),
})

function summarize(a: RouteAscentEntry['ascent']): string {
  if (!a) return '—'
  if (a.status === 'dns') return 'DNS'
  if (a.status === 'dnf') return 'DNF'
  if (a.status === 'dsq') return 'DSQ'
  if (a.isTop) return 'TOP'
  return `prise ${a.holdNumber}${a.modifier === 'plus' ? '+' : ''}`
}

function subjectOf(entry: RouteAscentEntry): string {
  return `${entry.bib ?? '—'} — ${entry.firstName} ${entry.lastName} — ${selected.value?.label ?? ''}`
}

function openFromList(entry: RouteAscentEntry): void {
  if (!selected.value) return
  editing.value = {
    mode: entry.ascent ? 'correct' : 'create',
    subject: subjectOf(entry),
    roundId: selected.value.roundId,
    routeId: selected.value.routeId,
    competitorId: entry.id,
    ascentId: entry.ascent?.id ?? null,
    holdNumber: entry.ascent?.holdNumber ?? null,
    modifier: entry.ascent?.modifier ?? 'none',
    isTop: entry.ascent?.isTop ?? false,
    status: entry.ascent?.status ?? 'valid',
    reason: '',
    holdCount: null,
  }
  editError.value = ''
}

/* --- Correction et saisie de secours, communes aux deux rendus ---------- */

const editing = ref<AscentEditTarget | null>(null)
const editError = ref('')

function closeEdit(): void {
  editing.value = null
}

function openFromMatrix(target: AscentEditTarget): void {
  editError.value = ''
  editing.value = target
}

async function refreshAfterWrite(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: listKey.value }),
    queryClient.invalidateQueries({
      queryKey: ['competitions', props.competitionId, 'ascents', 'matrix'],
    }),
    queryClient.invalidateQueries({ queryKey: ['competitions', props.competitionId, 'dashboard'] }),
  ])
}

const submitMutation = useMutation({
  mutationFn: async (state: AscentEditTarget) => {
    const shape = {
      holdNumber: state.isTop || state.status !== 'valid' ? null : state.holdNumber,
      modifier: state.modifier,
      isTop: state.status === 'valid' && state.isTop,
      status: state.status,
    }
    if (state.mode === 'create') {
      return organizerAscentsApi.create(props.competitionId, {
        roundId: state.roundId,
        routeId: state.routeId,
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
    await refreshAfterWrite()
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
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <PilotageMatrix
      v-if="isDesktop"
      :competition-id="competitionId"
      :categories="dashboard?.categories ?? []"
      @edit="openFromMatrix"
      @conflict="emit('open', 'conflicts')"
    />

    <template v-else>
      <Select
        v-model="selectedKey"
        label="Tour et voie"
        :options="[{ value: '', label: 'Choisir…' }, ...routeOptions]"
      />

      <p v-if="selected && isPending" class="text-gray-600">Chargement…</p>
      <ul v-else-if="selected && entries" class="flex flex-col gap-2">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <span class="font-medium text-gray-900"
              >{{ entry.bib ?? '—' }} — {{ entry.firstName }} {{ entry.lastName }}</span
            >
            <p class="text-sm text-gray-600">
              {{ entry.categoryLabel }} —
              <Badge :tone="entry.ascent ? 'success' : 'neutral'">{{
                summarize(entry.ascent)
              }}</Badge>
            </p>
          </div>
          <Button variant="secondary" @click="openFromList(entry)">
            {{ entry.ascent ? 'Corriger' : 'Saisir (secours)' }}
          </Button>
        </li>
        <li v-if="entries.length === 0" class="text-gray-600">
          Aucun compétiteur pour cette voie.
        </li>
      </ul>
    </template>

    <AscentEditDialog
      :target="editing"
      :error="editError"
      :busy="submitMutation.isPending.value"
      @submit="submitMutation.mutate($event)"
      @close="closeEdit"
    />
  </div>
</template>
