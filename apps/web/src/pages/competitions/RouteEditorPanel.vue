<script setup lang="ts">
import { createRouteInputSchema, type Category, type RouteHold } from '@climbcontest/contracts'
import { Button, NumberField, TextField, useToast } from '@climbcontest/ui'
import { useMutation } from '@tanstack/vue-query'
import { computed, reactive, ref, watch } from 'vue'

import { ApiError } from '../../api/client'
import { MASTER_DETAIL_QUERY, useMediaQuery } from '../../composables/useMediaQuery'
import { routePhotoApi, routesApi, type RouteWithCategories } from '../../api/competitions'
import { highestHoldNumber } from '../../lib/hold-numbering'
import type { PickedPhoto } from '../../lib/photo-crop'
import { PhotoUnreadableError, resizeToJpeg } from '../../lib/photo-resize'
import NewRoutePhoto from './NewRoutePhoto.vue'
import RoutePhotoEditor from './RoutePhotoEditor.vue'
import RouteVideoUploader from './RouteVideoUploader.vue'

/**
 * Création et modification d'une voie, y compris sa photo, ses prises et sa
 * vidéo. Un seul mode à la fois (ADR-075 point 8) : `route` désigne la voie
 * modifiée, `null` veut dire « ajouter ». Le panneau ne connaît ni la liste ni
 * son ordre — il prévient l'appelant, qui recharge.
 */
const props = defineProps<{
  competitionId: string
  route: RouteWithCategories | null
  categories: Category[]
}>()
const emit = defineEmits<{ saved: []; cancel: []; changed: [] }>()

const toast = useToast()

/**
 * Devenu le panneau de 24 rem du maître–détail (ADR-075), le formulaire n'a plus
 * la place de quatre colonnes : les valeurs y seraient tronquées. On le décide
 * ici et non en CSS, pour ne pas dépendre de l'ordre de cascade entre `sm:` et
 * le seuil de 1440 px.
 */
const isMasterDetail = useMediaQuery(MASTER_DETAIL_QUERY)
const fieldGridClass = computed(() =>
  isMasterDetail.value ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4',
)

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
const formError = ref('')

/** Une reprise de création est en cours : la quitter perdrait la photo ou les prises. */
const hasPendingCreation = computed(() => created.value !== null)
defineExpose({ hasPendingCreation })

// L'annotation PREND LE PAS sur le champ « Nombre de prises » (ADR-068) : la voie
// compte autant de prises que le plus haut numéro placé (une numérotation à trou
// reste valide, l'écran la signale).
const annotatedCount = computed(() =>
  props.route === null && holds.value.length > 0 ? highestHoldNumber(holds.value) : null,
)
const editingHasVideo = computed(() => props.route?.videoAssetId != null)

/**
 * La voie désignée change : on repart de ses valeurs. On suit l'identifiant et
 * non l'objet — la liste est rechargée après chaque enregistrement, et son objet
 * change d'identité sans que la voie ait bougé.
 */
watch(
  () => props.route?.id ?? null,
  (id) => {
    picked.value = null
    holds.value = []
    created.value = null
    formError.value = ''
    const route = props.route
    if (id === null || !route) {
      Object.assign(form, emptyForm())
      return
    }
    form.number = route.number
    form.name = route.name ?? ''
    form.holdCount = route.holdCount
    form.sector = route.sector ?? ''
    form.color = route.color ?? ''
    form.videoUrl = route.videoUrl ?? ''
    form.categoryIds = [...route.categoryIds]
  },
)

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
  onSuccess: ({ withPhoto, placed }) => {
    Object.assign(form, emptyForm())
    picked.value = null
    holds.value = []
    created.value = null
    emit('saved')
    if (withPhoto) {
      toast.show(
        placed > 0
          ? `Voie créée avec sa photo et ses ${placed} prises.`
          : 'Voie créée avec sa photo.',
        'success',
      )
    }
  },
  onError: (error) => {
    const reason = messageOf(error, 'Vérifiez le réseau et réessayez.')
    if (created.value === null) {
      formError.value = messageOf(error, 'Une erreur inattendue est survenue.')
      return
    }
    // La voie existe déjà : on l'affiche dans la liste et on dit quoi faire.
    emit('changed')
    const missing = created.value.photoSent
      ? 'ses prises n’ont pas pu être enregistrées'
      : 'sa photo n’a pas pu être envoyée'
    formError.value = `La voie a été créée, mais ${missing}. ${reason} Cliquez de nouveau sur « Ajouter » pour terminer : la voie ne sera pas créée en double.`
  },
})

const { mutate: updateRoute, isPending: isUpdating } = useMutation({
  mutationFn: () => routesApi.update(props.competitionId, props.route?.id ?? '', buildPayload()),
  onSuccess: () => {
    Object.assign(form, emptyForm())
    emit('saved')
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
  if (props.route) updateRoute()
  else createRoute()
}

function onCancel(): void {
  Object.assign(form, emptyForm())
  picked.value = null
  holds.value = []
  created.value = null
  formError.value = ''
  emit('cancel')
}
</script>

<template>
  <form
    class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
    @submit.prevent="onSubmit"
  >
    <h2 class="font-medium text-gray-900">
      {{ props.route ? 'Modifier la voie' : 'Ajouter une voie' }}
    </h2>
    <div class="grid gap-4" :class="fieldGridClass">
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
      v-if="props.route"
      :competition-id="competitionId"
      :route-id="props.route.id"
      :route-number="props.route.number"
      :hold-count="props.route.holdCount"
      :photo-asset-id="props.route.photoAssetId"
      :saved-holds="props.route.photoHolds ?? []"
      @changed="emit('changed')"
      @use-hold-count="(count: number) => (form.holdCount = count)"
    />
    <RouteVideoUploader
      v-if="props.route"
      :competition-id="competitionId"
      :route-id="props.route.id"
      :has-video="editingHasVideo"
      @changed="emit('changed')"
    />
    <template v-else>
      <NewRoutePhoto v-model:picked="picked" v-model:holds="holds" :route-number="form.number" />
      <p class="text-sm text-gray-600">Une vidéo peut s'ajouter une fois la voie enregistrée.</p>
    </template>
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-gray-900">Catégories concernées</legend>
      <label
        v-for="category in categories"
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
        {{ props.route ? 'Enregistrer' : isCreating ? 'Ajout en cours…' : 'Ajouter' }}
      </Button>
      <Button v-if="props.route || created" variant="secondary" @click="onCancel">Annuler</Button>
    </div>
  </form>
</template>
