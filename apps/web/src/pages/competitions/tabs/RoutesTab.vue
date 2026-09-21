<script setup lang="ts">
import { Button, DataList, useToast, type DataListColumn } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

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

// La voie ouverte vit dans l'adresse (ADR-075 point 4), comme la sous-section du
// pilotage : recharger la page en pleine annotation ne la referme pas. On écrit
// avec `replace` et non `push` — une entrée d'historique par ligne cliquée ferait
// du bouton « précédent » un désélecteur au lieu d'un retour.
// `urlRoute` et non `route` : dans ce fichier, une « route » est une voie.
const urlRoute = useRoute()
const router = useRouter()
const editingRouteId = computed<string | null>({
  get: () => {
    const requested = urlRoute.query.route
    if (typeof requested !== 'string' || requested === '') return null
    // Repli silencieux sur « aucune sélection » quand l'identifiant ne désigne
    // aucune voie. Tant que la liste est en vol, on garde la demande : sinon un
    // lien profond se refermerait avant même d'avoir été résolu.
    if (routes.value && !routes.value.some((r) => r.id === requested)) return null
    return requested
  },
  set: (id) => {
    const query = { ...urlRoute.query }
    delete query.route
    void router.replace({ query: id === null ? query : { ...query, route: id } })
  },
})
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

// Type minimal plutôt que `InstanceType<typeof RouteEditorPanel>` : le service
// de types d'ESLint ne résout pas l'instance d'un composant `.vue`.
const editorPanel = ref<{ hasPendingCreation: boolean } | null>(null)

function startEdit(target: RouteWithCategories): void {
  // Une création en reprise (ADR-067 point 5) tient la photo et les prises qui
  // ne sont pas parties : changer de voie les perdrait sans rien dire.
  if (editorPanel.value?.hasPendingCreation) {
    toast.show(
      'Terminez ou annulez la voie en cours d’ajout avant d’en ouvrir une autre : sa photo ou ses prises ne sont pas encore enregistrées.',
      'error',
    )
    return
  }
  editingRouteId.value = target.id
}

async function onSaved(): Promise<void> {
  editingRouteId.value = null
  await refresh()
}

/**
 * L'adresse peut désigner une voie qui n'existe pas (lien périmé, voie retirée
 * ailleurs). Le getter l'ignore déjà ; ce watch retire aussi le paramètre mort
 * de l'adresse, pour qu'un rechargement ne le ramène pas. Jamais pendant que la
 * liste est encore en vol.
 */
watch([routes, () => urlRoute.query.route], ([list, requested]) => {
  if (!list || typeof requested !== 'string' || requested === '') return
  if (list.some((candidate) => candidate.id === requested)) return
  editingRouteId.value = null
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
      ref="editorPanel"
      :competition-id="competitionId"
      :route="editingRoute ?? null"
      :categories="categoryList"
      @saved="onSaved"
      @cancel="editingRouteId = null"
      @changed="refresh"
    />
  </div>
</template>
