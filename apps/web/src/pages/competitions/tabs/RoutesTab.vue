<script setup lang="ts">
import { createRouteInputSchema, type RouteHold } from '@climbcontest/contracts'
import {
  Button,
  DataList,
  NumberField,
  TextField,
  useToast,
  type DataListColumn,
} from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import {
  categoriesApi,
  routePhotoApi,
  routesApi,
  type RouteWithCategories,
} from '../../../api/competitions'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'
import { highestHoldNumber } from '../../../lib/hold-numbering'
import type { PickedPhoto } from '../../../lib/photo-crop'
import { PhotoUnreadableError, resizeToJpeg } from '../../../lib/photo-resize'
import NewRoutePhoto from '../NewRoutePhoto.vue'
import RoutePhotoEditor from '../RoutePhotoEditor.vue'
import RouteVideoUploader from '../RouteVideoUploader.vue'

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

async function onVideoChanged(): Promise<void> {
  await refresh()
}

// Photo annotée (Lot 15, ADR-066).
const toast = useToast()
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

function emptyForm() {
  return {
    number: null as number | null,
    name: '',
    holdCount: null as number | null,
    sector: '',
    color: '',
    videoUrl: '',
    categoryIds: [] as string[],
  }
}
const form = reactive(emptyForm())
// Photo et prises de la voie en cours de création (ADR-067, ADR-068) ; en
// modification, l'éditeur a les siennes.
const picked = ref<PickedPhoto | null>(null)
const holds = ref<RouteHold[]>([])
// Voie déjà créée dont la photo ou les prises n'ont pas pu partir : « Ajouter »
// reprend où on s'est arrêté au lieu de créer un doublon.
const created = ref<{ routeId: string; photoSent: boolean } | null>(null)
// L'annotation PREND LE PAS sur le champ « Nombre de prises » (ADR-068) : la voie
// compte autant de prises que le plus haut numéro placé (une numérotation à trou
// reste valide, l'écran la signale).
const annotatedCount = computed(() =>
  editingRouteId.value === null && holds.value.length > 0 ? highestHoldNumber(holds.value) : null,
)
const editingRouteId = ref<string | null>(null)
const editingHasVideo = computed(
  () => routes.value?.find((r) => r.id === editingRouteId.value)?.videoAssetId != null,
)
const formError = ref('')

function buildPayload() {
  return {
    number: form.number ?? 0,
    name: form.name || null,
    holdCount: annotatedCount.value ?? form.holdCount ?? 0,
    sector: form.sector || null,
    color: form.color || null,
    videoUrl: form.videoUrl || null,
    categoryIds: form.categoryIds,
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail ?? error.title
  if (error instanceof PhotoUnreadableError) return error.message
  return fallback
}

// La photo et les prises passent par la voie : on réduit la photo AVANT de créer
// (un fichier illisible ne laisse pas de voie orpheline), puis voie, photo, prises.
// Chaque étape est reprenable : si le réseau lâche en route, `created` retient la
// voie déjà créée et « Ajouter » la met à jour et termine, sans doublon ni perte.
const { mutate: createRoute, isPending: isCreating } = useMutation({
  mutationFn: async () => {
    const chosen = picked.value
    const needsPhoto = chosen !== null && created.value?.photoSent !== true
    const jpeg =
      chosen && needsPhoto ? await resizeToJpeg(chosen.file, { crop: chosen.crop }) : null
    const existing = created.value
    if (existing) {
      await routesApi.update(props.competitionId, existing.routeId, buildPayload())
    } else {
      const route = await routesApi.create(props.competitionId, buildPayload())
      created.value = { routeId: route.id, photoSent: false }
    }
    const routeId = created.value?.routeId ?? ''
    if (jpeg) {
      await routePhotoApi.upload(props.competitionId, routeId, jpeg)
      created.value = { routeId, photoSent: true }
    }
    if (chosen && holds.value.length > 0) {
      const ordered = [...holds.value].sort((a, b) => a.number - b.number)
      await routePhotoApi.saveHolds(props.competitionId, routeId, ordered)
    }
    return { withPhoto: chosen !== null, placed: chosen ? holds.value.length : 0 }
  },
  onSuccess: async ({ withPhoto, placed }) => {
    await refresh()
    Object.assign(form, emptyForm())
    picked.value = null
    holds.value = []
    created.value = null
    if (withPhoto) {
      toast.show(
        placed > 0
          ? `Voie créée avec sa photo et ses ${placed} prises.`
          : 'Voie créée avec sa photo.',
        'success',
      )
    }
  },
  onError: async (error) => {
    const reason = messageOf(error, 'Vérifiez le réseau et réessayez.')
    if (created.value === null) {
      formError.value = messageOf(error, 'Une erreur inattendue est survenue.')
      return
    }
    // La voie existe déjà : on l'affiche dans la liste et on dit quoi faire.
    await refresh()
    const missing = created.value.photoSent
      ? 'ses prises n’ont pas pu être enregistrées'
      : 'sa photo n’a pas pu être envoyée'
    formError.value = `La voie a été créée, mais ${missing}. ${reason} Cliquez de nouveau sur « Ajouter » pour terminer : la voie ne sera pas créée en double.`
  },
})

const { mutate: updateRoute, isPending: isUpdating } = useMutation({
  mutationFn: () =>
    routesApi.update(props.competitionId, editingRouteId.value ?? '', buildPayload()),
  onSuccess: async () => {
    Object.assign(form, emptyForm())
    editingRouteId.value = null
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
  const result = createRouteInputSchema.safeParse(buildPayload())
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  if (editingRouteId.value) updateRoute()
  else createRoute()
}

function startEdit(route: {
  id: string
  number: number
  name: string | null
  holdCount: number
  sector: string | null
  color: string | null
  videoUrl: string | null
  categoryIds: string[]
}): void {
  editingRouteId.value = route.id
  picked.value = null
  holds.value = []
  created.value = null
  form.number = route.number
  form.name = route.name ?? ''
  form.holdCount = route.holdCount
  form.sector = route.sector ?? ''
  form.color = route.color ?? ''
  form.videoUrl = route.videoUrl ?? ''
  form.categoryIds = [...route.categoryIds]
}

function cancelEdit(): void {
  editingRouteId.value = null
  picked.value = null
  holds.value = []
  created.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
}

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
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'

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
            class="fine:min-h-10 fine:min-w-10 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Descendre"
            class="fine:min-h-10 fine:min-w-10 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
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

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
      @submit.prevent="onSubmit"
    >
      <h2 class="font-medium text-gray-900">
        {{ editingRouteId ? 'Modifier la voie' : 'Ajouter une voie' }}
      </h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NumberField v-model="form.number" label="Numéro" :min="1" required />
        <div
          v-if="annotatedCount !== null"
          class="flex flex-col gap-1"
          data-testid="hold-count-from-photo"
        >
          <span class="text-sm font-medium text-gray-900">Nombre de prises</span>
          <p
            class="flex min-h-12 items-center rounded-lg border border-gray-300 bg-gray-50 px-4 text-base font-semibold text-gray-900"
          >
            {{ annotatedCount }}
          </p>
          <p class="text-sm text-gray-600">
            D'après les prises placées sur la photo.
            <template v-if="form.holdCount !== null && form.holdCount !== annotatedCount">
              Remplace les {{ form.holdCount }} saisies.
            </template>
          </p>
        </div>
        <NumberField v-else v-model="form.holdCount" label="Nombre de prises" :min="1" required />
        <TextField v-model="form.name" label="Nom (optionnel)" />
        <TextField v-model="form.sector" label="Secteur (optionnel)" />
        <TextField v-model="form.color" label="Couleur (optionnelle)" />
        <TextField v-model="form.videoUrl" label="Vidéo (lien, optionnel)" />
      </div>
      <RoutePhotoEditor
        v-if="editingRoute"
        :competition-id="competitionId"
        :route-id="editingRoute.id"
        :route-number="editingRoute.number"
        :hold-count="editingRoute.holdCount"
        :photo-asset-id="editingRoute.photoAssetId"
        :saved-holds="editingRoute.photoHolds ?? []"
        @changed="refresh"
        @use-hold-count="(count) => (form.holdCount = count)"
      />
      <RouteVideoUploader
        v-if="editingRouteId"
        :competition-id="competitionId"
        :route-id="editingRouteId"
        :has-video="editingHasVideo"
        @changed="onVideoChanged"
      />
      <template v-else>
        <NewRoutePhoto v-model:picked="picked" v-model:holds="holds" :route-number="form.number" />
        <p class="text-sm text-gray-600">Une vidéo peut s'ajouter une fois la voie enregistrée.</p>
      </template>
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium text-gray-900">Catégories concernées</legend>
        <label
          v-for="category in categoryList"
          :key="category.id"
          class="flex min-h-12 items-center gap-2"
        >
          <input
            v-model="form.categoryIds"
            type="checkbox"
            :value="category.id"
            class="h-5 w-5 rounded border-gray-400"
          />
          {{ category.label }}
        </label>
      </fieldset>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <div class="flex gap-3">
        <Button type="submit" :disabled="isCreating || isUpdating">
          {{ editingRouteId ? 'Enregistrer' : isCreating ? 'Ajout en cours…' : 'Ajouter' }}
        </Button>
        <Button v-if="editingRouteId || created" variant="secondary" @click="cancelEdit">
          Annuler
        </Button>
      </div>
    </form>
  </div>
</template>
