<script setup lang="ts">
import { SyncStatusIndicator } from '@climbcontest/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { useSyncSnapshot } from './sync-runtime'

/**
 * Bandeau d'état permanent et honnête (ROADMAP.md Lot 6, point 6) : « Hors
 * ligne, N saisies en attente » / « Synchronisation… » / « À jour ».
 * Complémentaire à `SyncStatusIndicator` par ligne (déjà au Lot 1) — répond
 * à « puis-je faire confiance à mon appareil globalement ? », pas « cette
 * saisie précise est-elle passée ? ».
 */
const items = useSyncSnapshot()

const online = ref(navigator.onLine)
function updateOnline(): void {
  online.value = navigator.onLine
}
onMounted(() => {
  window.addEventListener('online', updateOnline)
  window.addEventListener('offline', updateOnline)
})
onUnmounted(() => {
  window.removeEventListener('online', updateOnline)
  window.removeEventListener('offline', updateOnline)
})

const pendingCount = computed(
  () => items.value.filter((item) => item.state === 'pending' || item.state === 'sending').length,
)

const status = computed<'offline' | 'syncing' | 'synced'>(() => {
  if (!online.value) return 'offline'
  if (pendingCount.value > 0) return 'syncing'
  return 'synced'
})
</script>

<template>
  <div
    data-testid="judge-sync-banner"
    class="sticky top-0 z-10 flex justify-center bg-white/90 px-4 py-2 backdrop-blur"
  >
    <SyncStatusIndicator :status="status" :pending-count="pendingCount" />
  </div>
</template>
