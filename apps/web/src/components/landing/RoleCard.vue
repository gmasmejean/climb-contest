<script setup lang="ts">
import { Badge } from '@climbcontest/ui'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

/**
 * Carte « pour qui » de la page d'accueil (ADR-070). Toute la carte est le
 * lien quand `to` est fourni (cible ≥ 48 px, aucun geste caché) ; sinon c'est
 * un simple bloc, sans flèche : l'affordance dit la vérité.
 */
defineProps<{
  title: string
  text: string
  tone: 'yellow' | 'green' | 'blue' | 'purple'
  to?: RouteLocationRaw | undefined
  badge?: string | undefined
}>()

const TONE_CLASS = {
  yellow: 'bg-card-yellow',
  green: 'bg-card-green',
  blue: 'bg-card-blue',
  purple: 'bg-card-purple',
} as const
</script>

<template>
  <li class="flex">
    <component
      :is="to ? RouterLink : 'div'"
      v-bind="to ? { to } : {}"
      class="text-ink flex min-h-40 w-full flex-col gap-2 rounded-2xl p-4 md:min-h-52 md:items-center md:p-5 md:text-center"
      :class="[
        TONE_CLASS[tone],
        to &&
          'focus-visible:outline-ink transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2',
      ]"
    >
      <span class="text-ink">
        <slot name="icon" />
      </span>
      <h2 class="text-lg leading-tight font-bold md:text-xl">{{ title }}</h2>
      <p class="text-sm leading-snug md:text-base">{{ text }}</p>
      <Badge v-if="badge" tone="neutral">{{ badge }}</Badge>
      <span v-if="to" aria-hidden="true" class="mt-auto self-end text-2xl leading-none">→</span>
    </component>
  </li>
</template>
