<script setup lang="ts">
import { Button, DataList, useToast, type DataListColumn } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'

import { ApiError } from '../../../api/client'
import {
  categoriesApi,
  routePhotoApi,
  routesApi,
  type RouteWithCategories,
} from '../../../api/competitions'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'
import RouteEditorPanel from '../RouteEditorPanel.vue'

const props = defineProps<{ competitionId: string }>()

const queryClient = useQueryClient()
const routesKey = ['competitions', props.competitionId, 'routes']
const categoriesKey = ['competitions', props.competitionId, 'categories']

const { data: routes, isPending } = useQuery({
  queryKey: routesKey,
  queryFn: () => routesApi.list(props.competitionId),
})
const { data: categories } = useQuery({
  queryKey: categoriesKey,
  queryFn: () => categoriesApi.list(props.competitionId),
})

// Photo annotée (Lot 15, ADR-066).
const toast = useToast()
const editingRouteId = ref<string | null>(null)
const editingRoute = computed(() => routes.value?.find((r) => r.id === editingRouteId.value))
const hasAnyPhoto = computed(() => routes.value?.some((r) => r.photoAssetId !== null) ?? false)
const printingSheets = ref(false)

async function printAllSheets(): Promise<void> {
  printingSheets.value = true
  try {
    await routePhotoApi.downloadSheets(props.competitionId)
  } catch (error) {
    toast.show(
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Impossible de générer les fiches. Réessayez.',
      'error',
    )
  } finally {
    printingSheets.value = false
  }
}

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: routesKey })
}

function startEdit(route: RouteWithCategories): void {
  editingRouteId.value = route.id
}

async function onSaved(): Promise<void> {
  editingRouteId.value = null
  await refresh()
}

/**
 * La voie en cours de modification peut quitter la liste (rechargement, retrait
 * depuis un autre appareil). `editingRoute` devient alors `undefined` et
 * l'éditeur disparaît, mais `editingRouteId` resterait posé : « Enregistrer »
 * enverrait un PATCH sur un identifiant mort. On rend la main au mode création.
 * Jamais pendant que la liste est encore en vol (`routes` vaut `undefined`),
 * sinon une voie ouverte par son adresse se refermerait toute seule.
 */
watch(routes, (list) => {
  const current = editingRouteId.value
  if (!list || current === null) return
  if (list.some((route) => route.id === current)) return
  editingRouteId.value = null
  toast.show("La voie que vous modifiiez n'est plus dans la liste.", 'error')
})

const { mutate: reorder } = useMutation({
  mutationFn: (orderedIds: string[]) => routesApi.reorder(props.competitionId, orderedIds),
  onSuccess: async () => refresh(),
})

function move(index: number, delta: number): void {
  if (!routes.value) return
  const target = index + delta
  if (target < 0 || target >= routes.value.length) return
  const ids = routes.value.map((r) => r.id)
  const [moved] = ids.splice(index, 1)
  if (moved === undefined) return
  ids.splice(target, 0, moved)
  reorder(ids)
}

function categoryLabels(ids: string[]): string {
  if (!categories.value || ids.length === 0) return '—'
  return ids
    .map((id) => categories.value?.find((c) => c.id === id)?.label)
    .filter(Boolean)
    .join(', ')
}

const categoryList = computed(() => categories.value ?? [])

const isDesktop = useMediaQuery(DESKTOP_QUERY)

/** Action de ligne compacte sous pointeur fin seulement (ADR-073). */
const rowActionClass =
  'fine:min-h-8 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'

/**
 * Aucune colonne triable (Lot 18) : l'ordre d'une compétition est celui que
 * l'organisateur a posé avec les flèches, pas l'ordre alphabétique. Un tri
 * masquerait ce que les flèches viennent de faire.
 */
const columns = computed<DataListColumn<RouteWithCategories>[]>(() => [
  {
    key: 'identity',
    label: 'Voie',
    card: 'title',
    tableHidden: true,
    value: (row) => `Voie ${row.number}${row.name ? ` — ${row.name}` : ''}`,
  },
  {
    key: 'number',
    label: 'N°',
    card: 'hidden',
    cellClass: 'w-16',
    value: (row) => String(row.number),
  },
  { key: 'name', label: 'Nom', card: 'hidden', value: (row) => row.name ?? '—' },
  {
    key: 'holdCount',
    label: 'Prises',
    card: 'hidden',
    cellClass: 'w-20',
    value: (row) => String(row.holdCount),
  },
  {
    key: 'sector',
    label: 'Secteur',
    card: 'hidden',
    cellClass: 'w-28',
    value: (row) => row.sector ?? '—',
  },
  { key: 'color', label: 'Couleur', card: 'hidden', cellClass: 'w-28' },
  { key: 'categories', label: 'Catégories', card: 'subtitle' },
  { key: 'media', label: 'Média', card: 'hidden', cellClass: 'w-28' },
  { key: 'actions', label: 'Actions', card: 'actions', labelHidden: true, cellClass: 'w-44' },
])
</script>

<template>
  <div class="flex flex-col gap-6">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <div v-if="hasAnyPhoto" class="flex flex-col gap-1">
      <div>
        <Button variant="secondary" :disabled="printingSheets" @click="printAllSheets">
          {{ printingSheets ? 'Génération…' : 'Imprimer les fiches voie' }}
        </Button>
      </div>
      <p class="text-sm text-gray-600">
        Un PDF, une page par voie ayant une photo, avec ses prises numérotées.
      </p>
    </div>
    <DataList
      v-if="!isPending"
      :rows="routes ?? []"
      :columns="columns"
      :layout="isDesktop ? 'table' : 'cards'"
      label="Voies, dans l’ordre de la compétition"
      empty-text="Aucune voie."
    >
      <!-- Le sous-titre de la carte reproduit la ligne d'avant mot pour mot ;
           en tableau, chaque élément a sa colonne. -->
      <template #cell-categories="{ row }">
        <template v-if="isDesktop">{{ categoryLabels(row.categoryIds) }}</template>
        <template v-else
          >{{ row.holdCount }} prises · {{ categoryLabels(row.categoryIds)
          }}<template v-if="row.photoAssetId"> · photo annotée</template></template
        >
      </template>

      <template #cell-color="{ row }">
        <span v-if="row.color" class="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            class="inline-block size-3 shrink-0 rounded-full ring-1 ring-gray-400"
            :style="{ backgroundColor: row.color }"
          />
          {{ row.color }}
        </span>
        <template v-else>—</template>
      </template>

      <template #cell-media="{ row }">
        <template v-if="row.photoAssetId && (row.videoUrl || row.videoAssetId)">
          Photo, vidéo
        </template>
        <template v-else-if="row.photoAssetId">Photo</template>
        <template v-else-if="row.videoUrl || row.videoAssetId">Vidéo</template>
        <template v-else>—</template>
      </template>

      <template #cell-actions="{ row, index }">
        <div class="flex items-center gap-1">
          <button
            type="button"
            aria-label="Monter"
            class="fine:min-h-8 fine:min-w-8 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Descendre"
            class="fine:min-h-8 fine:min-w-8 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="!routes || index === routes.length - 1"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <!-- Nommé exactement « Modifier » : trois parcours e2e (photo, recadrage,
               vidéo) ciblent ce bouton par son nom et prennent le premier. -->
          <button v-if="isDesktop" type="button" :class="rowActionClass" @click="startEdit(row)">
            Modifier
          </button>
          <Button v-else variant="secondary" @click="startEdit(row)">Modifier</Button>
        </div>
      </template>
    </DataList>

    <RouteEditorPanel
      :competition-id="competitionId"
      :route="editingRoute ?? null"
      :categories="categoryList"
      @saved="onSaved"
      @cancel="editingRouteId = null"
      @changed="refresh"
    />
  </div>
</template>
