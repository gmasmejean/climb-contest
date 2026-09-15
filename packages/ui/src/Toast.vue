<script setup lang="ts">
import { useToast } from './useToast'

const { toasts, dismiss } = useToast()
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
    style="padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem)"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      role="status"
      class="pointer-events-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-lg px-4 py-3 text-base shadow-lg"
      :class="{
        'bg-gray-900 text-white': toast.variant === 'info',
        'bg-green-700 text-white': toast.variant === 'success',
        'bg-red-700 text-white': toast.variant === 'error',
      }"
    >
      <span>{{ toast.text }}</span>
      <button
        type="button"
        aria-label="Fermer la notification"
        class="min-h-12 min-w-12 text-lg leading-none"
        @click="dismiss(toast.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>
