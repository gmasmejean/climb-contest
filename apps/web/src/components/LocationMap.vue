<script setup lang="ts">
import type { PublicAddress } from '@climbcontest/contracts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { LocationMapHandle } from '../lib/leaflet-map'
import { directionsUrl } from '../lib/organization-profile'

/**
 * Adresse d'un lieu, avec sa carte quand on connaît sa position (ADR-088).
 * L'adresse en texte et le lien « Itinéraire » sont toujours là : hors ligne,
 * ou si les tuiles ne viennent pas, la carte s'efface et rien d'autre ne
 * manque. Leaflet est chargé à la première carte affichée seulement.
 */

const props = defineProps<{ address: PublicAddress }>()

const container = ref<HTMLElement | null>(null)
const unavailable = ref(false)
const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
let handle: LocationMapHandle | null = null
let generation = 0

const position = computed(() =>
  props.address.latitude !== null && props.address.longitude !== null
    ? { latitude: props.address.latitude, longitude: props.address.longitude }
    : null,
)
const showMap = computed(() => position.value !== null && online.value && !unavailable.value)

function destroy(): void {
  handle?.destroy()
  handle = null
}

async function render(): Promise<void> {
  generation += 1
  const current = generation
  destroy()
  await nextTick()
  const target = position.value
  if (!showMap.value || !container.value || !target) return
  try {
    const { createLocationMap } = await import('../lib/leaflet-map')
    // Une autre adresse a pu être choisie pendant le chargement.
    if (current !== generation || !container.value) return
    handle = createLocationMap(container.value, target, () => {
      unavailable.value = true
      destroy()
    })
  } catch {
    // Fichier de la carte injoignable (hors ligne, pas encore en cache).
    unavailable.value = true
  }
}

function onOnline(): void {
  online.value = true
  unavailable.value = false
  void render()
}
function onOffline(): void {
  online.value = false
}

watch(
  () => (position.value ? `${position.value.latitude},${position.value.longitude}` : null),
  () => {
    unavailable.value = false
    void render()
  },
)

onMounted(() => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  void render()
})

onBeforeUnmount(() => {
  generation += 1
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  destroy()
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="showMap"
      ref="container"
      role="region"
      :aria-label="`Carte : ${address.label}`"
      class="isolate h-56 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
      data-testid="location-map"
    />
    <p class="text-gray-900">{{ address.label }}</p>
    <a
      :href="directionsUrl(address)"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex min-h-12 items-center self-start text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
    >
      Itinéraire<span class="sr-only"> vers {{ address.label }} (nouvelle fenêtre)</span>
    </a>
  </div>
</template>
