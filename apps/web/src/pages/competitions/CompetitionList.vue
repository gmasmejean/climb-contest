<script setup lang="ts">
import { retentionStatus } from '@climbcontest/contracts'
import { Badge, Button, Select, TextField } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { competitionsApi } from '../../api/competitions'
import { TRASH_VERBS, describeBulk, runBulk } from '../../lib/bulk-action'
import {
  STATUS_ORDER,
  applyListView,
  isDefaultListView,
  parseListView,
  serializeListView,
  toLocalDay,
  type CompetitionStatus,
  type ListView,
  type SortDir,
  type SortKey,
  type When,
} from '../../lib/competition-list-view'
import { UNREACHABLE_MESSAGE, describeError } from '../../lib/network-errors'
import ImportBackupModal from './ImportBackupModal.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()

const importOpen = ref(false)
const today = toLocalDay(new Date())

/** Rappel de conservation (ADR-051) : jamais une action automatique, seulement un rappel. */
function reminderOf(endsOn: string): { label: string; tone: 'warning' | 'danger' } | null {
  const status = retentionStatus(endsOn, today)
  if (status === 'purge_due') return { label: 'Plus de 5 ans : à purger', tone: 'danger' }
  if (status === 'archive_due')
    return { label: 'Plus de 2 ans : exporter puis purger', tone: 'warning' }
  return null
}

const { data, isPending, isError, refetch } = useQuery({
  queryKey: ['competitions'],
  queryFn: competitionsApi.list,
})

// Le nombre affiché sur le lien « Corbeille » : une information, jamais bloquante.
const { data: trashed } = useQuery({
  queryKey: ['competitions', 'trash'],
  queryFn: competitionsApi.listTrash,
})
const trashCount = computed(() => trashed.value?.length ?? 0)

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  open: 'Ouverte',
  running: 'En cours',
  closed: 'Clôturée',
  archived: 'Archivée',
}

// --- Recherche, filtres, tri : dans l'adresse de la page (ADR-062) ---

const urlView = computed(() => parseListView(route.query))
// Le champ de recherche garde sa valeur immédiate : l'adresse est mise à jour
// juste après, sans jamais avaler une frappe.
const searchText = ref(urlView.value.q)
const view = computed<ListView>(() => ({ ...urlView.value, q: searchText.value }))

function update(patch: Partial<ListView>): void {
  void router.replace({ query: serializeListView({ ...view.value, ...patch }) })
}

function onSearchInput(value: string): void {
  searchText.value = value
  update({ q: value })
}
// Retour arrière du navigateur, lien partagé : l'adresse redevient la source.
watch(
  () => urlView.value.q,
  (q) => {
    if (q !== searchText.value) searchText.value = q
  },
)

const activeFilterCount = computed(
  () =>
    view.value.statuses.length +
    (view.value.from === '' ? 0 : 1) +
    (view.value.to === '' ? 0 : 1) +
    (view.value.when === null ? 0 : 1),
)
const showFilters = ref(activeFilterCount.value > 0)

function toggleStatus(status: CompetitionStatus): void {
  const current = view.value.statuses
  update({
    statuses: current.includes(status)
      ? current.filter((value) => value !== status)
      : [...current, status],
  })
}

function toggleWhen(when: When): void {
  update({ when: view.value.when === when ? null : when })
}

const sortOptions = [
  { value: 'date:desc', label: 'Date — plus récentes d’abord' },
  { value: 'date:asc', label: 'Date — plus anciennes d’abord' },
  { value: 'name:asc', label: 'Nom — de A à Z' },
  { value: 'name:desc', label: 'Nom — de Z à A' },
  { value: 'status:asc', label: 'Statut — du brouillon à l’archivée' },
  { value: 'status:desc', label: 'Statut — de l’archivée au brouillon' },
]
const sortValue = computed(() => `${view.value.sort}:${view.value.dir}`)

function setSort(value: string): void {
  const [sort, dir] = value.split(':')
  update({ sort: sort as SortKey, dir: dir as SortDir })
}

function reset(): void {
  searchText.value = ''
  void router.replace({ query: {} })
}

const shown = computed(() => applyListView(data.value ?? [], view.value, today))
const hasFilter = computed(() => !isDefaultListView(view.value))

function chipClass(active: boolean): string {
  return [
    'min-h-12 rounded-full border px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700',
    active
      ? 'border-blue-700 bg-blue-700 text-white'
      : 'border-gray-500 bg-white text-gray-900 hover:bg-gray-50',
  ].join(' ')
}

// --- Sélection et mise à la corbeille (ADR-063) ---

const selecting = ref(false)
const selected = ref<string[]>([])
const busy = ref(false)
const bilan = ref<{ text: string; partial: boolean; movedSome: boolean } | null>(null)

/** Une compétition « En cours » ne se met pas à la corbeille : on ne la propose pas. */
const selectable = computed(() => shown.value.filter((c) => c.status !== 'running'))

// Ce qu'on ne voit plus ne reste pas sélectionné : jamais d'action sur du caché.
watch(shown, (rows) => {
  const visible = new Set(rows.map((c) => c.id))
  selected.value = selected.value.filter((id) => visible.has(id))
})

function startSelecting(): void {
  bilan.value = null
  selected.value = []
  selecting.value = true
}

function stopSelecting(): void {
  selecting.value = false
  selected.value = []
}

function toggleSelected(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id]
}

function selectAllShown(): void {
  selected.value = selectable.value.map((c) => c.id)
}

async function trashSelected(): Promise<void> {
  const items = (data.value ?? []).filter((c) => selected.value.includes(c.id))
  if (items.length === 0) return
  busy.value = true
  bilan.value = null
  const outcome = await runBulk(
    items,
    (c) => competitionsApi.trash(c.id),
    (e) => describeError(e),
  )
  bilan.value = {
    text: describeBulk(outcome, TRASH_VERBS),
    partial: outcome.failed.length > 0,
    movedSome: outcome.done.length > 0,
  }
  // Ce qui a échoué reste sélectionné, pour pouvoir réessayer ou comprendre.
  selected.value = outcome.failed.map((failure) => failure.item.id)
  if (outcome.failed.length === 0) selecting.value = false
  busy.value = false
  if (outcome.done.length > 0) await queryClient.invalidateQueries({ queryKey: ['competitions'] })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 py-8">
    <header class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-bold text-gray-900">Mes compétitions</h1>
      <RouterLink :to="{ name: 'competition-create' }">
        <Button>Nouvelle compétition</Button>
      </RouterLink>
    </header>
    <div class="flex flex-wrap gap-3">
      <Button variant="secondary" @click="importOpen = true">Importer une sauvegarde</Button>
      <RouterLink :to="{ name: 'competition-trash' }">
        <Button variant="secondary">
          Corbeille<template v-if="trashCount > 0"> ({{ trashCount }})</template>
        </Button>
      </RouterLink>
    </div>
    <ImportBackupModal :open="importOpen" @close="importOpen = false" />

    <div
      v-if="bilan"
      role="status"
      class="flex flex-col items-start gap-2 rounded-lg border p-4 text-base"
      :class="
        bilan.partial
          ? 'border-amber-700 bg-amber-50 text-amber-900'
          : 'border-green-700 bg-green-50 text-green-900'
      "
    >
      <p>{{ bilan.text }}</p>
      <RouterLink
        v-if="bilan.movedSome"
        :to="{ name: 'competition-trash' }"
        class="inline-flex min-h-12 items-center font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        Voir la corbeille pour la restaurer
      </RouterLink>
    </div>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <div v-else-if="isError && !data" role="alert" class="flex flex-col items-start gap-3">
      <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
      <Button variant="secondary" @click="() => refetch()">Réessayer</Button>
    </div>
    <p v-else-if="data?.length === 0" class="text-gray-600">
      Aucune compétition pour l'instant — créez la première.
    </p>

    <template v-else>
      <section aria-label="Rechercher, filtrer et trier" class="flex flex-col gap-4">
        <TextField
          :model-value="searchText"
          label="Rechercher (nom ou lieu)"
          autocomplete="off"
          @update:model-value="onSearchInput"
        />
        <Select
          :model-value="sortValue"
          label="Trier par"
          :options="sortOptions"
          @update:model-value="setSort"
        />
        <div class="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            :aria-expanded="showFilters"
            aria-controls="competition-filters"
            @click="showFilters = !showFilters"
          >
            Filtres<template v-if="activeFilterCount > 0"> ({{ activeFilterCount }})</template>
          </Button>
          <Button v-if="hasFilter" variant="secondary" @click="reset">Réinitialiser</Button>
        </div>

        <div v-show="showFilters" id="competition-filters" class="flex flex-col gap-4">
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-gray-900">Statut</legend>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="status in STATUS_ORDER"
                :key="status"
                type="button"
                :aria-pressed="view.statuses.includes(status)"
                :class="chipClass(view.statuses.includes(status))"
                @click="toggleStatus(status)"
              >
                {{ statusLabels[status] }}
              </button>
            </div>
            <p class="text-sm text-gray-600">Aucun statut choisi : toutes les compétitions.</p>
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-gray-900">Date</legend>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                :aria-pressed="view.when === 'upcoming'"
                :class="chipClass(view.when === 'upcoming')"
                @click="toggleWhen('upcoming')"
              >
                À venir ou en cours
              </button>
              <button
                type="button"
                :aria-pressed="view.when === 'past'"
                :class="chipClass(view.when === 'past')"
                @click="toggleWhen('past')"
              >
                Passées
              </button>
            </div>
            <div class="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <TextField
                :model-value="view.from"
                type="date"
                label="Début à partir du"
                @update:model-value="(value) => update({ from: value })"
              />
              <TextField
                :model-value="view.to"
                type="date"
                label="Début jusqu’au"
                @update:model-value="(value) => update({ to: value })"
              />
            </div>
          </fieldset>
        </div>
      </section>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-gray-700" aria-live="polite">
          <template v-if="shown.length === data?.length">
            {{ shown.length }} compétition{{ shown.length > 1 ? 's' : '' }}
          </template>
          <template v-else>{{ shown.length }} sur {{ data?.length }} compétitions</template>
        </p>
        <div class="flex flex-wrap gap-2">
          <template v-if="selecting">
            <Button variant="secondary" :disabled="busy" @click="selectAllShown">
              Tout sélectionner
            </Button>
            <Button variant="secondary" :disabled="busy" @click="stopSelecting">Terminer</Button>
          </template>
          <Button v-else variant="secondary" @click="startSelecting">Sélectionner</Button>
        </div>
      </div>

      <div v-if="shown.length === 0" class="flex flex-col items-start gap-3">
        <p class="text-gray-700">Aucune compétition ne correspond à votre recherche.</p>
        <Button variant="secondary" @click="reset">Réinitialiser la recherche</Button>
      </div>

      <ul v-else class="flex flex-col gap-3">
        <li v-for="competition in shown" :key="competition.id">
          <label
            v-if="selecting"
            class="flex min-h-12 items-center gap-4 rounded-lg border px-4 py-3"
            :class="[
              selected.includes(competition.id) ? 'border-blue-700 bg-blue-50' : 'border-gray-200',
              competition.status === 'running' ? 'opacity-70' : 'cursor-pointer hover:bg-gray-50',
            ]"
          >
            <input
              type="checkbox"
              class="size-6 shrink-0 accent-blue-700"
              :checked="selected.includes(competition.id)"
              :disabled="competition.status === 'running' || busy"
              @change="toggleSelected(competition.id)"
            />
            <span class="flex min-w-0 flex-col">
              <span class="font-medium text-gray-900">{{ competition.name }}</span>
              <span class="text-sm text-gray-600"
                >{{ competition.venue }} — {{ competition.startsOn }}</span
              >
              <span v-if="competition.status === 'running'" class="text-sm text-gray-700">
                En cours : clôturez-la pour pouvoir la supprimer.
              </span>
            </span>
          </label>
          <RouterLink
            v-else
            :to="{ name: 'competition-detail', params: { id: competition.id } }"
            class="flex min-h-12 items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <div class="flex min-w-0 flex-col">
              <span class="font-medium text-gray-900">{{ competition.name }}</span>
              <span class="text-sm text-gray-600"
                >{{ competition.venue }} — {{ competition.startsOn }}</span
              >
            </div>
            <div class="flex flex-col items-end gap-1">
              <Badge :tone="competition.status === 'draft' ? 'neutral' : 'success'">
                {{ statusLabels[competition.status] ?? competition.status }}
              </Badge>
              <Badge v-if="competition.purgedAt" tone="neutral">Données supprimées</Badge>
              <Badge
                v-else-if="reminderOf(competition.endsOn)"
                :tone="reminderOf(competition.endsOn)!.tone"
              >
                {{ reminderOf(competition.endsOn)!.label }}
              </Badge>
            </div>
          </RouterLink>
        </li>
      </ul>

      <div
        v-if="selecting"
        class="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3"
      >
        <p class="text-base font-medium text-gray-900" aria-live="polite">
          {{ selected.length }} sélectionnée{{ selected.length > 1 ? 's' : '' }}
        </p>
        <Button variant="danger" :disabled="selected.length === 0 || busy" @click="trashSelected">
          {{ busy ? 'En cours…' : 'Mettre à la corbeille' }}
        </Button>
      </div>
    </template>
  </main>
</template>
