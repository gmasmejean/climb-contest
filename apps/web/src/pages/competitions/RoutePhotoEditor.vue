<script setup lang="ts">
import {
  addHold,
  changeHoldNumber,
  moveHold,
  nextHoldNumber,
  removeHold,
  renumberByHeight,
  type RouteHold,
} from '@climbcontest/contracts'
import { Button, FileInput, Modal, NumberField, useToast } from '@climbcontest/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { ApiError } from '../../api/client'
import { routePhotoApi } from '../../api/competitions'
import HoldMarker from '../../components/HoldMarker.vue'
import { PhotoUnreadableError, resizeToJpeg } from '../../lib/photo-resize'

/**
 * Photo annotée d'une voie (Lot 15, ADR-066) : téléversement (ré-encodé en JPEG
 * dans le navigateur) puis placement des prises. Toucher la photo pose une prise,
 * toucher une prise la sélectionne, la glisser la déplace. Les modifications
 * restent locales jusqu'à « Enregistrer les prises » : « Annuler les
 * modifications » revient à ce que le serveur a.
 */
const props = defineProps<{
  competitionId: string
  routeId: string
  routeNumber: number
  /** Nombre de prises ENREGISTRÉ de la voie : le pavé du juge s'y arrête. */
  holdCount: number
  photoAssetId: string | null
  savedHolds: RouteHold[]
}>()
const emit = defineEmits<{ changed: []; 'use-hold-count': [count: number] }>()

const toast = useToast()

const holds = ref<RouteHold[]>([])
const selected = ref<number | null>(null)
const error = ref('')
const numberDraft = ref<number | null>(null)
const numberError = ref('')

const byNumber = (list: readonly RouteHold[]) => [...list].sort((a, b) => a.number - b.number)
const serialize = (list: readonly RouteHold[]) => JSON.stringify(byNumber(list))

function loadSaved(): void {
  holds.value = byNumber(props.savedHolds).map((hold) => ({ ...hold }))
  selected.value = null
}
// Une CLÉ texte, pas un tableau : un tableau neuf déclencherait la remise à zéro
// à chaque relecture des voies (retour sur l'onglet…), et effacerait les
// modifications en cours alors que rien n'a changé côté serveur.
watch(() => `${props.photoAssetId ?? ''}|${serialize(props.savedHolds)}`, loadSaved, {
  immediate: true,
})

const dirty = computed(() => serialize(holds.value) !== serialize(props.savedHolds))
const selectedHold = computed(() => holds.value.find((hold) => hold.number === selected.value))
watch(selectedHold, (hold) => {
  numberDraft.value = hold?.number ?? null
  numberError.value = ''
})

const highestNumber = computed(() => Math.max(0, ...holds.value.map((hold) => hold.number)))
// Premier numéro libre sous le plus haut : la numérotation a un trou.
const gapAt = computed(() => {
  const free = nextHoldNumber(holds.value)
  return free < highestNumber.value ? free : null
})
const isContiguous = computed(() => holds.value.length > 0 && gapAt.value === null)

// --- Aperçu de la photo (le jeton passe en en-tête : un <img src> ne le pourrait pas).
const imageUrl = ref<string | null>(null)
const imageError = ref(false)
let loadToken = 0

function releaseImage(): void {
  if (imageUrl.value !== null) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = null
}

async function loadImage(): Promise<void> {
  const token = (loadToken += 1)
  releaseImage()
  imageError.value = false
  if (!props.photoAssetId) return
  try {
    const blob = await routePhotoApi.fetchImage(props.competitionId, props.routeId)
    if (token !== loadToken) return
    imageUrl.value = URL.createObjectURL(blob)
  } catch {
    if (token === loadToken) imageError.value = true
  }
}
watch(() => props.photoAssetId, loadImage, { immediate: true })
onBeforeUnmount(() => {
  loadToken += 1
  releaseImage()
})

function messageOf(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) return caught.detail ?? caught.title
  if (caught instanceof PhotoUnreadableError) return caught.message
  return fallback
}

// --- Envoi, remplacement, suppression de la photo.
const file = ref<File | null>(null)
const sending = ref(false)
const confirmingReplace = ref(false)
const confirmingDelete = ref(false)

async function send(): Promise<void> {
  const chosen = file.value
  if (!chosen) return
  confirmingReplace.value = false
  error.value = ''
  sending.value = true
  try {
    const jpeg = await resizeToJpeg(chosen)
    await routePhotoApi.upload(props.competitionId, props.routeId, jpeg)
    file.value = null
    toast.show('Photo enregistrée.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(
      caught,
      'L’envoi de la photo a échoué. Vérifiez le réseau et réessayez.',
    )
  } finally {
    sending.value = false
  }
}

function askSend(): void {
  // Remplacer la photo efface les prises : on le dit avant, pas après.
  if (props.photoAssetId && props.savedHolds.length > 0) confirmingReplace.value = true
  else void send()
}

async function removePhoto(): Promise<void> {
  confirmingDelete.value = false
  error.value = ''
  try {
    await routePhotoApi.remove(props.competitionId, props.routeId)
    toast.show('Photo supprimée.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible de supprimer la photo. Réessayez.')
  }
}

// --- Placement des prises.
const frame = ref<HTMLElement | null>(null)

function pointOf(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const rect = frame.value?.getBoundingClientRect()
  if (!rect || rect.width === 0 || rect.height === 0) return null
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  }
}

function onFrameClick(event: MouseEvent): void {
  const point = pointOf(event)
  if (!point || !imageUrl.value) return
  error.value = ''
  const number = nextHoldNumber(holds.value)
  if (number > props.holdCount) {
    error.value = `Les ${props.holdCount} prises de la voie sont déjà placées. Pour en placer davantage, augmentez d'abord le nombre de prises et enregistrez la voie.`
    return
  }
  holds.value = addHold(holds.value, point.x, point.y)
  selected.value = number
}

let dragging: { number: number; pointerId: number } | null = null

function onMarkerDown(event: PointerEvent, number: number): void {
  selected.value = number
  dragging = { number, pointerId: event.pointerId }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function onMarkerMove(event: PointerEvent): void {
  if (!dragging || event.pointerId !== dragging.pointerId) return
  const point = pointOf(event)
  if (point) holds.value = moveHold(holds.value, dragging.number, point.x, point.y)
}
function onMarkerUp(): void {
  dragging = null
}

// Au clavier : flèches pour déplacer (Maj = plus grand pas), Suppr pour retirer.
function onMarkerKey(event: KeyboardEvent, hold: RouteHold): void {
  const step = event.shiftKey ? 0.05 : 0.01
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const move = moves[event.key]
  if (move) {
    event.preventDefault()
    holds.value = moveHold(holds.value, hold.number, hold.x + move[0], hold.y + move[1])
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelected()
  }
}

function deleteSelected(): void {
  if (selected.value === null) return
  holds.value = removeHold(holds.value, selected.value)
  selected.value = null
}

function applyNumber(): void {
  const current = selected.value
  if (current === null) return
  const result = changeHoldNumber(holds.value, current, numberDraft.value ?? Number.NaN)
  if (!result.ok) {
    numberError.value =
      result.reason === 'taken'
        ? `Le numéro ${numberDraft.value} est déjà utilisé par une autre prise.`
        : 'Le numéro doit être un entier à partir de 1.'
    return
  }
  numberError.value = ''
  holds.value = result.holds
  selected.value = numberDraft.value
}

function renumber(): void {
  holds.value = renumberByHeight(holds.value)
  selected.value = null
}

// --- Enregistrement de l'annotation.
const saving = ref(false)

async function saveHolds(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    await routePhotoApi.saveHolds(props.competitionId, props.routeId, byNumber(holds.value))
    toast.show('Prises enregistrées.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible d’enregistrer les prises. Réessayez.')
  } finally {
    saving.value = false
  }
}

const printing = ref(false)
async function printSheet(): Promise<void> {
  error.value = ''
  printing.value = true
  try {
    await routePhotoApi.downloadSheets(props.competitionId, props.routeId)
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible de générer la fiche. Réessayez.')
  } finally {
    printing.value = false
  }
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-gray-200 p-4"
    aria-label="Photo annotée de la voie"
    data-testid="route-photo-editor"
  >
    <h3 class="text-sm font-semibold text-gray-900">Photo annotée de la voie</h3>

    <template v-if="props.photoAssetId">
      <p class="text-sm text-gray-700">
        Touchez la photo pour placer une prise. Touchez une prise pour la sélectionner, glissez-la
        pour la déplacer.
      </p>

      <div
        ref="frame"
        class="relative w-full touch-manipulation overflow-hidden rounded-lg bg-gray-100 select-none"
        data-testid="photo-frame"
        @click="onFrameClick"
      >
        <img
          v-if="imageUrl"
          :src="imageUrl"
          :alt="`Photo de la voie ${props.routeNumber}`"
          class="block h-auto w-full"
          draggable="false"
        />
        <p v-else-if="imageError" role="alert" class="p-4 text-sm text-red-700">
          Impossible de charger la photo. Vérifiez le réseau puis rechargez la page.
        </p>
        <p v-else class="p-4 text-sm text-gray-700">Chargement de la photo…</p>

        <template v-if="imageUrl">
          <HoldMarker
            v-for="hold in holds"
            :key="`m-${hold.number}`"
            :number="hold.number"
            :x="hold.x"
            :y="hold.y"
            :selected="hold.number === selected"
          />
          <button
            v-for="hold in holds"
            :key="`b-${hold.number}`"
            type="button"
            class="absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            :style="{ left: `${hold.x * 100}%`, top: `${hold.y * 100}%` }"
            :aria-label="`Prise ${hold.number}`"
            :aria-pressed="hold.number === selected"
            data-testid="hold-handle"
            @click.stop="selected = hold.number"
            @pointerdown.stop="onMarkerDown($event, hold.number)"
            @pointermove="onMarkerMove"
            @pointerup="onMarkerUp"
            @pointercancel="onMarkerUp"
            @keydown="onMarkerKey($event, hold)"
          />
        </template>
      </div>

      <div v-if="selectedHold" class="flex flex-col gap-3 rounded-lg bg-blue-50 p-3">
        <p class="text-sm font-medium text-gray-900">
          Prise {{ selectedHold.number }} sélectionnée
        </p>
        <div class="flex items-end gap-3">
          <NumberField
            v-model="numberDraft"
            label="Numéro de la prise"
            :min="1"
            :error="numberError || undefined"
          />
          <Button variant="secondary" @click="applyNumber">Changer le numéro</Button>
        </div>
        <div class="flex flex-wrap gap-3">
          <Button variant="danger" @click="deleteSelected">Supprimer cette prise</Button>
          <Button variant="secondary" @click="selected = null">Terminé</Button>
        </div>
      </div>

      <p
        class="text-sm"
        :class="holds.length === props.holdCount ? 'text-gray-800' : 'text-amber-800'"
        data-testid="hold-counter"
        aria-live="polite"
      >
        {{ holds.length }} {{ plural(holds.length, 'prise placée', 'prises placées') }} sur
        {{ props.holdCount }}
        <template v-if="holds.length < props.holdCount">
          — il en manque {{ props.holdCount - holds.length }}.
        </template>
      </p>
      <p v-if="gapAt !== null" class="text-sm text-amber-800">
        La numérotation a un trou : le numéro {{ gapAt }} n'est utilisé par aucune prise.
      </p>

      <div class="flex flex-wrap gap-3">
        <Button variant="secondary" :disabled="holds.length === 0" @click="renumber">
          Renuméroter de bas en haut
        </Button>
        <Button v-if="dirty" variant="secondary" @click="loadSaved"
          >Annuler les modifications</Button
        >
      </div>
      <p class="text-sm text-gray-600">
        « Renuméroter » classe les prises d'après leur hauteur sur la photo. À vérifier sur une
        traversée ou un dévers, où la hauteur ne suit pas le parcours.
      </p>

      <div
        v-if="holds.length > 0 && holds.length !== props.holdCount && isContiguous && !dirty"
        class="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
      >
        <p class="text-sm text-amber-900">
          Vous avez placé {{ holds.length }} prises alors que la voie en compte
          {{ props.holdCount }}.
        </p>
        <div>
          <Button variant="secondary" @click="emit('use-hold-count', holds.length)">
            Utiliser {{ holds.length }} comme nombre de prises
          </Button>
        </div>
        <p class="text-sm text-amber-900">
          Le nombre est reporté dans le champ ci-dessus : il ne change qu'après « Enregistrer ».
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <Button :disabled="!dirty || saving" @click="saveHolds">
          {{ saving ? 'Enregistrement…' : 'Enregistrer les prises' }}
        </Button>
      </div>
      <p v-if="dirty" class="text-sm text-amber-800" role="status">
        Modifications non enregistrées.
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <Button variant="secondary" :disabled="dirty || printing" @click="printSheet">
          {{ printing ? 'Génération…' : 'Imprimer la fiche de cette voie' }}
        </Button>
        <span v-if="dirty" class="text-sm text-gray-600">Enregistrez d'abord les prises.</span>
      </div>
    </template>
    <p v-else class="text-sm text-gray-700">
      Aucune photo. Ajoutez celle que les juges reçoivent d'habitude, puis placez-y les prises : le
      juge pourra l'afficher depuis son téléphone, même sans réseau.
    </p>

    <FileInput
      v-model="file"
      :label="props.photoAssetId ? 'Remplacer la photo' : 'Choisir une photo'"
      accept="image/*"
      hint="La voie en entier, prise de face. La photo est réduite avant l'envoi."
    />
    <p v-if="props.photoAssetId && props.savedHolds.length > 0" class="text-sm text-amber-800">
      Remplacer la photo efface les prises déjà placées.
    </p>

    <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>

    <div class="flex flex-wrap gap-3">
      <Button :disabled="!file || sending" @click="askSend">
        {{
          sending
            ? 'Envoi en cours…'
            : props.photoAssetId
              ? 'Envoyer la nouvelle photo'
              : 'Envoyer la photo'
        }}
      </Button>
      <Button v-if="props.photoAssetId" variant="secondary" @click="confirmingDelete = true">
        Supprimer la photo
      </Button>
    </div>

    <Modal
      :open="confirmingReplace"
      title="Remplacer la photo ?"
      @close="confirmingReplace = false"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">
          Les {{ props.savedHolds.length }} prises placées sur l'ancienne photo seront effacées :
          elles ne correspondraient pas à la nouvelle. Il faudra les replacer.
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingReplace = false">Garder l'ancienne</Button>
          <Button @click="send">Remplacer la photo</Button>
        </div>
      </div>
    </Modal>

    <Modal :open="confirmingDelete" title="Supprimer la photo ?" @close="confirmingDelete = false">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">
          La photo et les prises placées dessus seront supprimées. Les juges ne la verront plus.
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingDelete = false">Garder la photo</Button>
          <Button variant="danger" @click="removePhoto">Supprimer la photo</Button>
        </div>
      </div>
    </Modal>
  </section>
</template>
