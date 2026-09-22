<script setup lang="ts">
import type { ActivityLogEntry } from '@climbcontest/contracts'
import { Badge, Button, DataList, Select, TextField, useToast } from '@climbcontest/ui'
import type { DataListColumn, DataListSort } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { dashboardApi, type ActivityLogFilters } from '../../../api/dashboard'
import ListToolbar from '../../../components/ListToolbar.vue'
import { DESKTOP_QUERY, useMediaQuery, WIDE_QUERY } from '../../../composables/useMediaQuery'
import { compareText, sortRows } from '../../../lib/table-sort'

const props = defineProps<{ competitionId: string }>()
const toast = useToast()

const isDesktop = useMediaQuery(DESKTOP_QUERY)
const isWide = useMediaQuery(WIDE_QUERY)

const TYPE_LABELS: Record<ActivityLogEntry['type'], string> = {
  round_status_changed: 'Statut du tour',
  competitor_status_changed: 'Statut du compétiteur',
  ascent_created: 'Passage saisi',
  ascent_corrected: 'Passage corrigé',
  ascent_voided: 'Passage annulé',
  conflict_resolved: 'Conflit résolu',
}
const ACTOR_LABELS: Record<ActivityLogEntry['actorType'], string> = {
  judge: 'Juge',
  organizer: 'Organisateur',
  system: 'Système',
}

const typeFilter = ref('')
const actorTypeFilter = ref('')
const fromFilter = ref('')
const toFilter = ref('')

const typeOptions = [
  { value: '', label: 'Tous les types' },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
]
const actorTypeOptions = [
  { value: '', label: 'Tous les acteurs' },
  ...Object.entries(ACTOR_LABELS).map(([value, label]) => ({ value, label })),
]

/**
 * `<input type="date">` donne une date LOCALE ; le serveur compare des
 * horodatages UTC. Passer par `new Date('…T00:00:00')` (sans `Z`, donc lu en
 * heure locale) évite de perdre les premières heures d'une journée de
 * compétition en France — l'erreur qu'un `${date}T00:00:00Z` naïf produirait.
 */
function dayStart(date: string): string | undefined {
  return date === '' ? undefined : new Date(`${date}T00:00:00`).toISOString()
}
function dayEnd(date: string): string | undefined {
  return date === '' ? undefined : new Date(`${date}T23:59:59.999`).toISOString()
}

const filters = computed<ActivityLogFilters>(() => {
  const result: ActivityLogFilters = {}
  if (typeFilter.value) result.type = typeFilter.value
  if (actorTypeFilter.value) result.actorType = actorTypeFilter.value
  const from = dayStart(fromFilter.value)
  if (from !== undefined) result.from = from
  const to = dayEnd(toFilter.value)
  if (to !== undefined) result.to = to
  return result
})

const { data, isPending } = useQuery({
  queryKey: ['competitions', props.competitionId, 'activity-log', filters],
  queryFn: () => dashboardApi.activityLog(props.competitionId, filters.value),
})

/** `payload` est un `Record<string, unknown>` : rien n'y est sûr d'être lisible. */
function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
}

function detail(entry: ActivityLogEntry): string {
  return Object.entries(entry.payload)
    .map(([key, value]) => `${key} : ${describeValue(value)}`)
    .join(', ')
}

function timestamp(entry: ActivityLogEntry): string {
  return new Date(entry.createdAt).toLocaleString('fr-FR')
}

/**
 * Une seule définition de colonnes pour les deux rendus (ADR-074). Le journal
 * arrive déjà du plus récent au plus ancien : c'est l'ordre par défaut, et
 * `sort` reste `null` tant que l'organisateur n'a rien demandé.
 */
const columns = computed<DataListColumn<ActivityLogEntry>[]>(() => [
  {
    key: 'createdAt',
    label: 'Heure',
    card: 'subtitle',
    cellClass: 'w-40',
    value: (row) => timestamp(row),
    compare: (a, b) => a.createdAt.localeCompare(b.createdAt),
  },
  {
    key: 'type',
    label: 'Type',
    card: 'title',
    value: (row) => TYPE_LABELS[row.type],
    compare: (a, b) => compareText(TYPE_LABELS[a.type], TYPE_LABELS[b.type]),
  },
  {
    key: 'actor',
    label: 'Acteur',
    card: 'subtitle',
    cellClass: 'w-48',
    value: (row) => row.actorLabel ?? ACTOR_LABELS[row.actorType],
    compare: (a, b) =>
      compareText(
        a.actorLabel ?? ACTOR_LABELS[a.actorType],
        b.actorLabel ?? ACTOR_LABELS[b.actorType],
      ),
  },
  {
    key: 'reason',
    label: 'Motif',
    card: 'subtitle',
    value: (row) => row.reason ?? '—',
  },
  {
    // Colonne de confort (ADR-074 point 7) : le détail brut n'a de place qu'au
    // delà de 1280 px, et n'a jamais eu de place sur une carte.
    key: 'detail',
    label: 'Détail',
    card: 'hidden',
    tableHidden: !isWide.value,
    value: (row) => detail(row),
  },
])

const sort = ref<DataListSort | null>(null)
const rows = computed(() =>
  sortRows(data.value?.entries ?? [], sort.value, columns.value, (a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  ),
)

const isDownloading = ref(false)
async function downloadCsv(): Promise<void> {
  isDownloading.value = true
  try {
    const blob = await dashboardApi.downloadActivityLogCsv(props.competitionId, filters.value)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `journal-activite-${props.competitionId}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.show('Impossible de générer le journal.', 'error')
  } finally {
    isDownloading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <ListToolbar>
      <div class="lg:w-56"><Select v-model="typeFilter" label="Type" :options="typeOptions" /></div>
      <div class="lg:w-48">
        <Select v-model="actorTypeFilter" label="Acteur" :options="actorTypeOptions" />
      </div>
      <div class="lg:w-44"><TextField v-model="fromFilter" label="À partir du" type="date" /></div>
      <div class="lg:w-44"><TextField v-model="toFilter" label="Jusqu’au" type="date" /></div>
      <template #actions>
        <Button variant="secondary" :disabled="isDownloading" @click="downloadCsv">
          {{ isDownloading ? 'Génération…' : 'Exporter en CSV' }}
        </Button>
      </template>
    </ListToolbar>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <DataList
      v-else
      :rows="rows"
      :columns="columns"
      :layout="isDesktop ? 'table' : 'cards'"
      :sort="sort"
      label="Journal d’activité de la compétition"
      empty-text="Aucune activité."
      @update:sort="sort = $event"
    >
      <template #cell-type="{ row }">
        <Badge tone="neutral">{{ TYPE_LABELS[row.type] }}</Badge>
      </template>
    </DataList>
  </div>
</template>
