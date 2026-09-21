<script setup lang="ts">
import { Badge } from '@climbcontest/ui'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import { TONE_CLASS, watercolorBackground, type WatercolorTone } from '../brand/watercolor'

/**
 * Carte « pour qui » de la page d'accueil (ADR-070). Toute la carte est le
 * lien quand `to` est fourni (cible ≥ 48 px, aucun geste caché) ; sinon c'est
 * un simple bloc, sans flèche : l'affordance dit la vérité.
 *
 * Le fond est une texture aquarelle par teinte ; la couleur unie reste dessous
 * le temps du chargement (les images ne sont pas précachées, ADR-070).
 */
defineProps<{
  title: string
  text: string
  tone: WatercolorTone
  to?: RouteLocationRaw | undefined
  badge?: string | undefined
}>()
</script>

<template>
  <li class="flex">
    <component
      :is="to ? RouterLink : 'div'"
      v-bind="to ? { to } : {}"
      class="text-ink flex min-h-40 w-full flex-col gap-2 rounded-2xl p-4 md:min-h-52 md:items-center md:p-5 md:text-center"
      :class="[
        TONE_CLASS[tone],
        'bg-cover bg-center',
        to &&
          'focus-visible:outline-ink transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2',
      ]"
      :style="{ backgroundImage: watercolorBackground(tone) }"
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
