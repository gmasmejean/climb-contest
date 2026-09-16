<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'success' | 'warning' | 'danger'
  }>(),
  {
    tone: 'neutral',
  },
)
</script>

<template>
  <span
    class="inline-flex min-h-8 items-center rounded-full px-3 py-1 text-sm font-medium"
    :class="[
      tone === 'neutral' && 'bg-gray-100 text-gray-900',
      tone === 'success' && 'bg-green-100 text-green-900',
      tone === 'warning' && 'bg-amber-100 text-amber-900',
      tone === 'danger' && 'bg-red-100 text-red-900',
    ]"
  >
    <slot />
  </span>
</template>
