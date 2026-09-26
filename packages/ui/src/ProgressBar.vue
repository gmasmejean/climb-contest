<script setup lang="ts">
import { computed } from 'vue'

/**
 * Avancement `value / max`, pour la progression jour J (ROADMAP.md Lot 20).
 *
 * La barre est TOUJOURS doublée du compte en clair : sur un portable posé à la
 * table de l'organisation, en salle mal éclairée, une barre seule ne se lit pas,
 * et « 12 / 30 » est la seule information sur laquelle on prend une décision.
 *
 * Aucune décision de largeur ici — le composant s'étire dans ce qu'on lui donne.
 * C'est la condition pour qu'il vive dans `packages/ui` (même règle que
 * `ListToolbar`, resté dans `apps/web` parce qu'il porte le seuil de 1024 px).
 */
const props = withDefaults(
  defineProps<{
    /** Passages saisis. */
    value: number
    /** Passages attendus. `0` = rien d'attendu : la barre est indéterminée. */
    max: number
    /** Ce que la barre mesure, p. ex. « Voie 3 — Le surplomb ». */
    label: string
    /** Masque le libellé à l'œil sans le retirer du nom accessible. */
    labelHidden?: boolean
  }>(),
  { labelHidden: false },
)

const hasScale = computed(() => props.max > 0)
/** Bornée à [0, 100] pour l'affichage seul : le compte en clair, lui, ne ment pas. */
const percent = computed(() =>
  hasScale.value ? Math.min(100, Math.max(0, (props.value / props.max) * 100)) : 0,
)
const isComplete = computed(() => hasScale.value && props.value >= props.max)
const valueText = computed(() => `${props.value} / ${props.max}`)
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-baseline justify-between gap-2 text-sm">
      <span :class="labelHidden ? 'sr-only' : 'min-w-0 truncate text-gray-700'">{{ label }}</span>
      <span class="shrink-0 font-medium text-gray-900 tabular-nums">{{ valueText }}</span>
    </div>
    <div
      role="progressbar"
      :aria-label="label"
      :aria-valuenow="hasScale ? value : undefined"
      :aria-valuemin="hasScale ? 0 : undefined"
      :aria-valuemax="hasScale ? max : undefined"
      :aria-valuetext="hasScale ? `${value} sur ${max}` : 'aucun passage attendu'"
      class="h-2 w-full overflow-hidden rounded-full bg-gray-200"
    >
      <div
        class="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
        :class="isComplete ? 'bg-green-700' : 'bg-blue-700'"
        :style="{ width: `${percent}%` }"
      />
    </div>
  </div>
</template>
