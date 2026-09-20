<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import {
  FULL_CROP,
  isFullCrop,
  moveCrop,
  resizeCrop,
  type CropCorner,
  type CropRect,
} from '../lib/photo-crop'

/**
 * Recadrage d'une photo de voie (ADR-067), en plein écran : un rectangle libre
 * dont on tire les coins (cibles de 48 px, aussi aux flèches du clavier), zoom
 * ×1 / ×2 / ×3 avec défilement pour être précis (même schéma que le panneau du
 * juge, ADR-066). Le rectangle se déplace aussi à la souris ; au doigt, glisser à
 * l'intérieur fait défiler la vue zoomée — les coins suffisent à tout faire, rien
 * n'est réservé à un geste. Rien n'est appliqué avant « Appliquer le recadrage ».
 */
const props = defineProps<{
  open: boolean
  imageUrl: string
  /** Zone déjà choisie, ou `null` pour la photo entière. */
  crop: CropRect | null
}>()
const emit = defineEmits<{ apply: [crop: CropRect | null]; close: [] }>()

const ZOOMS = [1, 2, 3] as const
const zoom = ref<(typeof ZOOMS)[number]>(1)
const draft = ref<CropRect>({ ...FULL_CROP })
const frame = ref<HTMLElement | null>(null)
const dialog = ref<HTMLElement | null>(null)

const CORNERS: Array<{ corner: CropCorner; label: string }> = [
  { corner: 'nw', label: 'Coin haut gauche' },
  { corner: 'ne', label: 'Coin haut droit' },
  { corner: 'sw', label: 'Coin bas gauche' },
  { corner: 'se', label: 'Coin bas droit' },
]

function cornerPosition(corner: CropCorner): { left: string; top: string } {
  const { x, y, width, height } = draft.value
  return {
    left: `${(corner === 'nw' || corner === 'sw' ? x : x + width) * 100}%`,
    top: `${(corner === 'nw' || corner === 'ne' ? y : y + height) * 100}%`,
  }
}

let previouslyFocused: HTMLElement | null = null
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      draft.value = props.crop ? { ...props.crop } : { ...FULL_CROP }
      zoom.value = 1
      previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-close]')?.focus()
    } else {
      previouslyFocused?.focus()
      previouslyFocused = null
    }
  },
  { immediate: true },
)

// --- Glisser : un coin (redimensionne) ou l'intérieur (déplace, à la souris).
interface Drag {
  /** Le coin tiré, ou `null` quand on déplace toute la zone. */
  corner: CropCorner | null
  pointerId: number
  x: number
  y: number
  start: CropRect
  box: DOMRect
}
let drag: Drag | null = null

function begin(event: PointerEvent, corner: CropCorner | null): void {
  const box = frame.value?.getBoundingClientRect()
  if (!box || box.width === 0 || box.height === 0) return
  drag = {
    corner,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    start: { ...draft.value },
    box,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onDrag(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return
  // Écart depuis le début du geste, normalisé : pas de dérive cumulée.
  const dx = (event.clientX - drag.x) / drag.box.width
  const dy = (event.clientY - drag.y) / drag.box.height
  draft.value = drag.corner
    ? resizeCrop(drag.start, drag.corner, dx, dy)
    : moveCrop(drag.start, dx, dy)
}

function endDrag(): void {
  drag = null
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

// Au clavier : flèches (Maj = plus grand pas) sur un coin ou sur la zone.
function onKey(event: KeyboardEvent, corner: CropCorner | null): void {
  const arrow = ARROWS[event.key]
  if (!arrow) return
  event.preventDefault()
  const step = event.shiftKey ? 0.05 : 0.01
  const [dx, dy] = [arrow[0] * step, arrow[1] * step]
  draft.value = corner ? resizeCrop(draft.value, corner, dx, dy) : moveCrop(draft.value, dx, dy)
}

// --- Zoom : garde au centre de l'écran ce qui y était.
const scroller = ref<HTMLElement | null>(null)

// À ×1 la photo doit tenir ENTIÈRE dans l'espace disponible (sinon, sur un
// téléphone, on recadre une photo dont on ne voit pas le bas) : sa largeur de base
// est celle qui remplit la largeur ou la hauteur, la première qui bute. Les
// 48 px sont le rembourrage (`p-6`) qui laisse les coins atteignables au bord.
const PADDING = 48
const aspect = ref(0)
const room = ref<{ width: number; height: number } | null>(null)
let observer: ResizeObserver | null = null

function measure(): void {
  const el = scroller.value
  if (el) room.value = { width: el.clientWidth - PADDING, height: el.clientHeight - PADDING }
}
watch(scroller, (el) => {
  observer?.disconnect()
  observer = null
  if (!el) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(el)
  }
})
onBeforeUnmount(() => observer?.disconnect())

function onImageLoad(event: Event): void {
  const image = event.target as HTMLImageElement
  aspect.value = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0
}

// Repli sur la largeur du conteneur tant que les tailles ne sont pas connues.
const frameWidth = computed(() => {
  const size = room.value
  if (aspect.value <= 0 || !size || size.width <= 0 || size.height <= 0) {
    return `${zoom.value * 100}%`
  }
  const base = Math.min(size.width, size.height * aspect.value)
  return `${Math.max(1, base) * zoom.value}px`
})
async function setZoom(level: (typeof ZOOMS)[number]): Promise<void> {
  const el = scroller.value
  const centerX =
    el && el.scrollWidth > 0 ? (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth : 0.5
  const centerY =
    el && el.scrollHeight > 0 ? (el.scrollTop + el.clientHeight / 2) / el.scrollHeight : 0.5
  zoom.value = level
  await nextTick()
  if (!el) return
  el.scrollLeft = centerX * el.scrollWidth - el.clientWidth / 2
  el.scrollTop = centerY * el.scrollHeight - el.clientHeight / 2
}

function apply(): void {
  emit('apply', isFullCrop(draft.value) ? null : { ...draft.value })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Recadrer la photo"
      data-testid="photo-crop-dialog"
      class="fixed inset-0 z-50 flex flex-col bg-white"
      @keydown.esc="emit('close')"
    >
      <header class="flex items-center justify-between gap-2 px-4 py-2">
        <h2 class="text-lg font-bold text-gray-900">Recadrer la photo</h2>
        <Button data-close variant="secondary" @click="emit('close')">Annuler</Button>
      </header>

      <p class="px-4 pb-2 text-sm text-gray-800">
        Tirez les coins pour garder la partie utile de la photo. Zoomez pour être plus précis.
      </p>

      <div class="flex gap-2 px-4 pb-2" role="group" aria-label="Zoom">
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

      <div ref="scroller" class="min-h-0 flex-1 overflow-auto overscroll-contain bg-gray-200 p-6">
        <div
          ref="frame"
          class="relative mx-auto"
          :style="{ width: frameWidth }"
          data-testid="crop-frame"
        >
          <img
            :src="props.imageUrl"
            alt="Photo à recadrer"
            class="block h-auto w-full max-w-none select-none"
            draggable="false"
            @load="onImageLoad"
          />
          <!-- La zone gardée ; l'ombre géante assombrit tout ce qui est en dehors. -->
          <div
            class="absolute cursor-move border-2 border-white outline outline-2 outline-black focus-visible:outline-blue-500"
            :style="{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.width * 100}%`,
              height: `${draft.height * 100}%`,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
            }"
            tabindex="0"
            role="group"
            aria-label="Zone gardée. Flèches pour la déplacer."
            data-testid="crop-area"
            @pointerdown="begin($event, null)"
            @pointermove="onDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @keydown="onKey($event, null)"
          />
          <button
            v-for="item in CORNERS"
            :key="item.corner"
            type="button"
            class="absolute flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            :style="cornerPosition(item.corner)"
            :aria-label="item.label"
            :data-corner="item.corner"
            data-testid="crop-handle"
            @pointerdown.stop="begin($event, item.corner)"
            @pointermove="onDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
            @keydown="onKey($event, item.corner)"
          >
            <span class="h-5 w-5 rounded-sm border-2 border-black bg-white" aria-hidden="true" />
          </button>
        </div>
      </div>

      <footer class="flex flex-wrap justify-end gap-3 px-4 py-3">
        <Button variant="secondary" :disabled="isFullCrop(draft)" @click="draft = { ...FULL_CROP }">
          Garder la photo entière
        </Button>
        <Button @click="apply">Appliquer le recadrage</Button>
      </footer>
    </div>
  </Teleport>
</template>
