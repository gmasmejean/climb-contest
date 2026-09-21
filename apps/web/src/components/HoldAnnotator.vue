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
import { Button, NumberField } from '@climbcontest/ui'
import { computed, ref, watch } from 'vue'

import { useZoomableFrame, ZOOMS } from '../composables/useZoomableFrame'
import { numberingGap } from '../lib/hold-numbering'
import HoldMarker from './HoldMarker.vue'

/**
 * Placement des prises sur la photo d'une voie (Lot 15, ADR-066), partagé par
 * l'éditeur d'une voie enregistrée et par la création d'une voie (ADR-068).
 * Toucher la photo pose une prise, toucher une prise la sélectionne, la glisser
 * la déplace. Ne sait ni enregistrer ni envoyer : il tient la liste des prises
 * (`v-model`), l'appelant en fait ce qu'il veut.
 */
const props = defineProps<{
  /** La photo à annoter ; `null` tant qu'elle se charge. */
  imageUrl: string | null
  /** Le chargement a échoué : on le dit à la place de la photo. */
  imageError?: boolean
  /** Numéro de la voie pour la description de l'image ; `null` tant qu'il n'est pas saisi. */
  routeNumber: number | null
  /**
   * Nombre de prises de la voie : plafond de la pose (le pavé du juge s'y arrête).
   * `null` à la création, où c'est le nombre de prises placées qui le fixe.
   */
  holdCount: number | null
  /**
   * Mode plein écran (ADR-077) : la photo occupe la hauteur disponible, avec le
   * zoom et le défilement. Hors de ce mode, elle remplit la largeur du parent,
   * comme avant — c'est le rendu inchangé de la colonne et du téléphone.
   */
  expanded?: boolean
}>()
const holds = defineModel<RouteHold[]>({ required: true })

const selected = ref<number | null>(null)
const numberDraft = ref<number | null>(null)
const numberError = ref('')
const limitError = ref('')

const selectedHold = computed(() => holds.value.find((hold) => hold.number === selected.value))
watch(selectedHold, (hold) => {
  numberDraft.value = hold?.number ?? null
  numberError.value = ''
  // La prise sélectionnée a disparu (liste remplacée, annulation…) : on désélectionne.
  if (!hold) selected.value = null
})

const gapAt = computed(() => numberingGap(holds.value))

// --- Placement des prises.
const frame = ref<HTMLElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const { zoom, frameWidth, setZoom, onImageLoad } = useZoomableFrame(scroller)

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
  if (!point || !props.imageUrl) return
  limitError.value = ''
  const number = nextHoldNumber(holds.value)
  if (props.holdCount !== null && number > props.holdCount) {
    limitError.value = `Les ${props.holdCount} prises de la voie sont déjà placées. Pour en placer davantage, augmentez d'abord le nombre de prises et enregistrez la voie.`
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

// « 2 prises placées sur 5 — il en manque 3. » ; sans plafond (création) : « 2 prises placées ».
const counterText = computed(() => {
  const placed = holds.value.length
  const text = `${placed} ${placed > 1 ? 'prises placées' : 'prise placée'}`
  if (props.holdCount === null) return text
  const missing = props.holdCount - placed
  return `${text} sur ${props.holdCount}${missing > 0 ? ` — il en manque ${missing}.` : ''}`
})
</script>

<template>
  <div
    class="flex flex-col gap-3"
    :class="props.expanded ? 'min-h-0 flex-1' : ''"
    data-testid="hold-annotator"
  >
    <p class="text-sm text-gray-700">
      Touchez la photo pour placer une prise. Touchez une prise pour la sélectionner, glissez-la
      pour la déplacer.
    </p>

    <div v-if="props.expanded" class="flex gap-2" role="group" aria-label="Zoom">
      <Button
        v-for="level in ZOOMS"
        :key="level"
        :variant="zoom === level ? 'primary' : 'secondary'"
        :aria-pressed="zoom === level"
        full-width
        @click="setZoom(level)"
      >
        ×{{ level }}
      </Button>
    </div>

    <div
      ref="scroller"
      :class="
        props.expanded ? 'min-h-0 flex-1 overflow-auto overscroll-contain bg-gray-200 p-6' : ''
      "
    >
      <div
        ref="frame"
        class="relative touch-manipulation overflow-hidden rounded-lg bg-gray-100 select-none"
        :class="props.expanded ? 'mx-auto' : 'w-full'"
        :style="props.expanded ? { width: frameWidth } : undefined"
        data-testid="photo-frame"
        @click="onFrameClick"
      >
        <img
          v-if="props.imageUrl"
          :src="props.imageUrl"
          :alt="props.routeNumber ? `Photo de la voie ${props.routeNumber}` : 'Photo de la voie'"
          class="block h-auto w-full max-w-none"
          draggable="false"
          @load="onImageLoad"
        />
        <p v-else-if="props.imageError" role="alert" class="p-4 text-sm text-red-700">
          Impossible de charger la photo. Vérifiez le réseau puis rechargez la page.
        </p>
        <p v-else class="p-4 text-sm text-gray-700">Chargement de la photo…</p>

        <template v-if="props.imageUrl">
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
    </div>

    <p v-if="limitError" role="alert" class="text-sm text-red-700">{{ limitError }}</p>

    <div v-if="selectedHold" class="flex flex-col gap-3 rounded-lg bg-blue-50 p-3">
      <p class="text-sm font-medium text-gray-900">Prise {{ selectedHold.number }} sélectionnée</p>
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
      :class="
        props.holdCount === null || holds.length === props.holdCount
          ? 'text-gray-800'
          : 'text-amber-800'
      "
      data-testid="hold-counter"
      aria-live="polite"
    >
      {{ counterText }}
    </p>
    <p v-if="gapAt !== null" class="text-sm text-amber-800">
      La numérotation a un trou : le numéro {{ gapAt }} n'est utilisé par aucune prise.
    </p>

    <div>
      <Button variant="secondary" :disabled="holds.length === 0" @click="renumber">
        Renuméroter de bas en haut
      </Button>
    </div>
    <p class="text-sm text-gray-600">
      « Renuméroter » classe les prises d'après leur hauteur sur la photo. À vérifier sur une
      traversée ou un dévers, où la hauteur ne suit pas le parcours.
    </p>
  </div>
</template>
