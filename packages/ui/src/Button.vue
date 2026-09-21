<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * Bouton « pilule » de la charte (ADR-071). Avec `to`, c'est un vrai lien
 * (`RouterLink`) ; sinon un `<button>`.
 *
 * `glass` : navy translucide + flou d'arrière-plan, pour un bouton posé sur
 * un décor aquarelle. 80 % d'opacité : texte blanc ≥ 7:1 même sur papier clair.
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'glass'
    type?: 'button' | 'submit'
    disabled?: boolean
    fullWidth?: boolean
    to?: RouteLocationRaw | undefined
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
  <component
    :is="to ? RouterLink : 'button'"
    v-bind="to ? { to } : { type, disabled }"
    class="inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full px-5 py-3 text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    :class="[
      fullWidth ? 'w-full' : '',
      variant === 'primary' &&
        'bg-blue-800 text-white hover:bg-blue-700 focus-visible:outline-blue-700',
      variant === 'secondary' &&
        'bg-white/80 text-blue-700 ring-1 ring-inset ring-blue-700 hover:bg-white focus-visible:outline-blue-700',
      variant === 'danger' &&
        'bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700',
      variant === 'glass' &&
        'bg-blue-800/80 text-white shadow-sm ring-1 ring-inset ring-white/30 backdrop-blur-sm hover:bg-blue-800 focus-visible:outline-blue-700',
    ]"
  >
    <slot />
  </component>
</template>
