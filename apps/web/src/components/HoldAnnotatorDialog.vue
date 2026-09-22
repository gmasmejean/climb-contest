<script setup lang="ts">
import type { RouteHold } from '@climbcontest/contracts'
import { Button } from '@climbcontest/ui'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import HoldAnnotator from './HoldAnnotator.vue'

/**
 * Placement des prises en plein écran (ADR-077), avec zoom et défilement. Le
 * même `v-model` que l'annotateur en ligne : fermer ne perd rien, et rien n'est
 * envoyé ici. Disponible à toutes les largeurs — sur un mur chargé, c'est le
 * téléphone devant le mur qui en a le plus besoin.
 */
const props = defineProps<{
  open: boolean
  imageUrl: string | null
  imageError?: boolean
  routeNumber: number | null
  holdCount: number | null
}>()
const emit = defineEmits<{ close: [] }>()
const holds = defineModel<RouteHold[]>({ required: true })

const dialog = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

/**
 * Échap est écouté sur le document et non sur le dialogue : après avoir touché
 * la photo, le focus est sur le corps de page (le cadre n'est pas focusable) et
 * un `@keydown.esc` local ne recevrait plus rien.
 */
function onEscape(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') emit('close')
}
onBeforeUnmount(() => document.removeEventListener('keydown', onEscape))

// Le focus part sur « Fermer » à l'ouverture et revient à l'ouvrant après —
// `Modal` de packages/ui ne le fait pas encore, le dialogue de recadrage si.
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onEscape)
      previouslyFocused =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-close]')?.focus()
    } else {
      document.removeEventListener('keydown', onEscape)
      previouslyFocused?.focus()
      previouslyFocused = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      ref="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Placer les prises"
      data-testid="hold-annotator-dialog"
      class="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <header class="flex items-center justify-between gap-2 px-4 py-2">
        <h2 class="text-lg font-bold text-gray-900">
          Placer les prises<template v-if="props.routeNumber">
            — voie {{ props.routeNumber }}</template
          >
        </h2>
        <Button data-close variant="secondary" @click="emit('close')">Fermer</Button>
      </header>

      <p class="px-4 pb-2 text-sm text-gray-800">
        Touchez la photo pour placer une prise. Touchez une prise pour la sélectionner, glissez-la
        pour la déplacer. Zoomez pour être plus précis.
      </p>

      <div class="flex min-h-0 flex-1 flex-col px-4 pb-3">
        <HoldAnnotator
          v-model="holds"
          expanded
          :image-url="props.imageUrl"
          :image-error="props.imageError"
          :route-number="props.routeNumber"
          :hold-count="props.holdCount"
        />
      </div>
    </div>
  </Teleport>
</template>
