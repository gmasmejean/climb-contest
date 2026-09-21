<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * Bouton « pilule » de la page d'accueil (ADR-070). Local à la page : deux
 * usages seulement, on ne charge pas `packages/ui` d'une variante de marque
 * tant que la charte n'est pas étendue au reste de l'application.
 *
 * Avec `to`, c'est un vrai lien (`RouterLink`) ; sinon un `<button>`.
 */
withDefaults(
  defineProps<{
    to?: RouteLocationRaw | undefined
    variant?: 'solid' | 'outline'
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  {
    variant: 'solid',
    type: 'button',
    disabled: false,
  },
)
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    v-bind="to ? { to } : { type, disabled }"
    class="focus-visible:outline-navy inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 py-2 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    :class="
      variant === 'solid'
        ? 'bg-navy-deep hover:bg-navy text-white'
        : 'text-navy ring-navy bg-white/80 ring-1 ring-inset hover:bg-white'
    "
  >
    <slot />
  </component>
</template>
