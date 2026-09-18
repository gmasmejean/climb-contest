<script setup lang="ts">
import { computed } from 'vue'

/**
 * Indicateur visuel seul. `conflict` ajouté au Lot 6 (`packages/sync`) : une
 * saisie dont un autre appareil a enregistré une valeur différente pour le
 * même passage — l'organisateur tranche (SPEC.md § 6.3, Lot 8). Voir
 * ROADMAP.md Lot 1, point 7.
 */
const props = defineProps<{
  status: 'offline' | 'pending' | 'syncing' | 'synced' | 'conflict'
  pendingCount?: number
}>()

const label = computed(() => {
  switch (props.status) {
    case 'offline':
      return props.pendingCount
        ? `Hors ligne, ${props.pendingCount} saisie(s) en attente`
        : 'Hors ligne'
    case 'pending':
      return `${props.pendingCount ?? 0} saisie(s) en attente`
    case 'syncing':
      return 'Synchronisation…'
    case 'synced':
      return 'À jour'
    case 'conflict':
      return 'Conflit — organisateur alerté'
  }
  return ''
})
</script>

<template>
  <div
    role="status"
    class="inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium"
    :class="{
      'bg-red-100 text-red-800': status === 'offline' || status === 'conflict',
      'bg-amber-100 text-amber-800': status === 'pending' || status === 'syncing',
      'bg-green-100 text-green-800': status === 'synced',
    }"
  >
    <span
      class="h-2.5 w-2.5 rounded-full"
      :class="{
        'bg-red-600': status === 'offline' || status === 'conflict',
        'animate-pulse bg-amber-600': status === 'pending' || status === 'syncing',
        'bg-green-600': status === 'synced',
      }"
      aria-hidden="true"
    />
    {{ label }}
  </div>
</template>
