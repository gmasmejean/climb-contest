<script setup lang="ts">
import { createRouteInputSchema } from '@climbcontest/contracts'
import { Button, NumberField, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, routePhotoApi, routesApi } from '../../../api/competitions'
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
const editingRouteId = ref<string | null>(null)
const editingHasVideo = computed(
  () => routes.value?.find((r) => r.id === editingRouteId.value)?.videoAssetId != null,
)
const formError = ref('')

function buildPayload() {
  return {
    number: form.number ?? 0,
    name: form.name || null,
    holdCount: form.holdCount ?? 0,
    sector: form.sector || null,
    color: form.color || null,
    videoUrl: form.videoUrl || null,
    categoryIds: form.categoryIds,
  }
}

const { mutate: createRoute, isPending: isCreating } = useMutation({
  mutationFn: () => routesApi.create(props.competitionId, buildPayload()),
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
    <ul v-if="!isPending" class="flex flex-col gap-2">
      <li
        v-for="(route, index) in routes"
        :key="route.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <span class="font-medium text-gray-900"
            >Voie {{ route.number }}<span v-if="route.name"> — {{ route.name }}</span></span
          >
          <p class="text-sm text-gray-600">
            {{ route.holdCount }} prises · {{ categoryLabels(route.categoryIds)
            }}<template v-if="route.photoAssetId"> · photo annotée</template>
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
            :disabled="!routes || index === routes.length - 1"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <Button variant="secondary" @click="startEdit(route)">Modifier</Button>
        </div>
      </li>
      <li v-if="routes && routes.length === 0" class="text-gray-600">Aucune voie.</li>
    </ul>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
      @submit.prevent="onSubmit"
    >
      <h2 class="font-medium text-gray-900">
        {{ editingRouteId ? 'Modifier la voie' : 'Ajouter une voie' }}
      </h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NumberField v-model="form.number" label="Numéro" :min="1" required />
        <NumberField v-model="form.holdCount" label="Nombre de prises" :min="1" required />
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
      <p v-else class="text-sm text-gray-600">
        Enregistrez la voie pour pouvoir y ajouter une photo annotée et une vidéo.
      </p>
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
          {{ editingRouteId ? 'Enregistrer' : 'Ajouter' }}
        </Button>
        <Button v-if="editingRouteId" variant="secondary" @click="cancelEdit">Annuler</Button>
      </div>
    </form>
  </div>
</template>
