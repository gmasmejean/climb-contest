<script setup lang="ts">
import type { RoutePhoto } from '@climbcontest/contracts'
import { Button } from '@climbcontest/ui'
import { computed, nextTick, ref, toRef, watch } from 'vue'

import HoldMarker from '../../components/HoldMarker.vue'
import { useRoutePhotoUrl } from '../../judge/useRoutePhotoUrl'

/**
 * La voie annotée, en panneau plein écran qui glisse depuis la droite (ADR-066).
 * Lue depuis IndexedDB : jamais de requête réseau. Le bouton « Masquer la voie »
 * est TOUJOURS visible ; le balayage vers la droite ferme aussi le panneau, mais
 * n'est qu'un raccourci (CLAUDE.md : pas de geste caché).
 */
const props = defineProps<{
  routeId: string
  routeNumber: number
  photo: RoutePhoto
  open: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const url = useRoutePhotoUrl(
  props.routeId,
  computed(() => props.photo.assetId),
  toRef(props, 'open'),
)

const ZOOMS = [1, 2, 3] as const
const zoom = ref<(typeof ZOOMS)[number]>(1)

const closeButton = ref<InstanceType<typeof Button> | null>(null)
let previouslyFocused: HTMLElement | null = null

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      zoom.value = 1
      previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      closeButton.value?.$el.focus()
    } else {
      previouslyFocused?.focus()
      previouslyFocused = null
    }
  },
)

// Balayage vers la droite pour fermer : seulement à l'échelle 1, où la photo ne
// déborde pas en largeur — au-dessus, un glissement horizontal sert à se déplacer.
let touchStart: { x: number; y: number } | null = null
function onTouchStart(event: TouchEvent): void {
  const touch = event.touches[0]
  touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null
}
function onTouchEnd(event: TouchEvent): void {
  const touch = event.changedTouches[0]
  const start = touchStart
  touchStart = null
  if (!start || !touch || zoom.value !== 1) return
  const dx = touch.clientX - start.x
  const dy = touch.clientY - start.y
  if (dx > 80 && dx > Math.abs(dy) * 2) emit('close')
}
</script>

<template>
  <Transition
    enter-from-class="translate-x-full"
    enter-active-class="transition-transform duration-200 ease-out motion-reduce:transition-none"
    leave-active-class="transition-transform duration-200 ease-in motion-reduce:transition-none"
    leave-to-class="translate-x-full"
  >
    <div
      v-if="props.open"
      role="dialog"
      aria-modal="true"
      :aria-label="`Voie ${props.routeNumber} annotée`"
      data-testid="route-photo-panel"
      class="fixed inset-0 z-40 flex flex-col bg-gray-900"
      @keydown.esc="emit('close')"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <header class="flex items-center justify-between gap-2 bg-white px-4 py-2">
        <h2 class="text-lg font-bold text-gray-900">Voie {{ props.routeNumber }}</h2>
        <Button ref="closeButton" variant="secondary" @click="emit('close')">
          Masquer la voie
        </Button>
      </header>

      <div class="flex gap-2 bg-white px-4 pb-2" role="group" aria-label="Zoom">
        <Button
          v-for="level in ZOOMS"
          :key="level"
          :variant="zoom === level ? 'primary' : 'secondary'"
          :aria-pressed="zoom === level"
          full-width
          @click="zoom = level"
        >
          ×{{ level }}
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div v-if="url" class="relative" :style="{ width: `${zoom * 100}%` }">
          <img
            :src="url"
            :alt="`Photo de la voie ${props.routeNumber}, avec le numéro de chaque prise`"
            class="block h-auto w-full max-w-none select-none"
            draggable="false"
          />
          <HoldMarker
            v-for="hold in props.photo.holds"
            :key="hold.number"
            :number="hold.number"
            :x="hold.x"
            :y="hold.y"
          />
        </div>
        <p v-else role="status" class="m-4 rounded-lg bg-white px-4 py-4 text-gray-900">
          La photo de cette voie n'est pas encore sur cet appareil. Elle se télécharge dès que le
          réseau revient — vous pouvez continuer à saisir les passages.
        </p>
      </div>

      <p
        v-if="url && props.photo.holds.length === 0"
        class="bg-white px-4 py-2 text-sm text-gray-900"
      >
        Aucun numéro de prise n'est placé sur cette photo.
      </p>
    </div>
  </Transition>
</template>
