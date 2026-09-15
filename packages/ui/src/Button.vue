<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger'
    type?: 'button' | 'submit'
    disabled?: boolean
    fullWidth?: boolean
  }>(),
  {
    variant: 'primary',
    type: 'button',
    disabled: false,
    fullWidth: false,
  },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="min-h-12 min-w-12 rounded-lg px-5 py-3 text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      fullWidth ? 'w-full' : '',
      variant === 'primary' &&
        'bg-blue-700 text-white hover:bg-blue-800 focus-visible:outline-blue-700',
      variant === 'secondary' &&
        'bg-white text-blue-700 ring-1 ring-inset ring-blue-700 hover:bg-blue-50 focus-visible:outline-blue-700',
      variant === 'danger' &&
        'bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700',
    ]"
  >
    <slot />
  </button>
</template>
