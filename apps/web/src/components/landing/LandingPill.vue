<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * Bouton « pilule » de la page d'accueil (ADR-070). Local à la page : deux
 * usages seulement, on ne charge pas `packages/ui` d'une variante de marque
 * tant que la charte n'est pas étendue au reste de l'application.
 *
 * Avec `to`, c'est un vrai lien (`RouterLink`) ; sinon un `<button>`.
 *
 * `glass` : navy translucide + flou d'arrière-plan, pour la pilule posée sur le
 * mur aquarelle. 80 % d'opacité : texte blanc ≥ 7:1 même sur le papier clair.
 */
withDefaults(
  defineProps<{
    to?: RouteLocationRaw | undefined
    variant?: 'solid' | 'glass' | 'outline'
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
    :class="{
      'bg-navy-deep hover:bg-navy text-white': variant === 'solid',
      'bg-navy-deep/80 hover:bg-navy-deep text-white shadow-sm ring-1 ring-white/30 backdrop-blur-sm ring-inset':
        variant === 'glass',
      'text-navy ring-navy bg-white/80 ring-1 ring-inset hover:bg-white': variant === 'outline',
    }"
  >
    <slot />
  </component>
</template>
