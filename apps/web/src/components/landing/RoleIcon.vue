<script setup lang="ts">
/**
 * Icônes de la page d'accueil (ADR-070), tracées à la main : le dépôt n'a pas
 * de bibliothèque d'icônes et ces sept dessins n'en justifient pas une.
 * Décoratives : toujours `aria-hidden`, le texte voisin porte le sens.
 */
defineProps<{
  name: 'organizers' | 'judges' | 'spectators' | 'climbers' | 'search' | 'peak' | 'user'
}>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- Presse-papiers à coches -->
    <template v-if="name === 'organizers'">
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M8.5 10.5l1.5 1.5 2.5-3" />
      <path d="M14 11h2.5" />
      <path d="M8.5 16l1.5 1.5 2.5-3" />
      <path d="M14 16.5h2.5" />
    </template>

    <!-- Tablette « 10 » et doigt qui touche -->
    <template v-else-if="name === 'judges'">
      <rect x="4" y="3" width="12" height="16" rx="2" />
      <path d="M7.5 7.5V11" />
      <path d="M10.5 7.5a1.3 1.75 0 1 1 0 3.5 1.3 1.75 0 1 1 0-3.5z" />
      <path d="M7 14.5l1 1 1.8-2" />
      <path d="M14.5 21v-4.5a1.2 1.2 0 0 1 2.4 0V18l2.1.6a1.6 1.6 0 0 1 1 1.5V21" />
    </template>

    <!-- Jumelles -->
    <template v-else-if="name === 'spectators'">
      <path d="M9 9V6a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v3" />
      <path d="M18 9V6a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v3" />
      <path d="M9 9h6" />
      <circle cx="6.5" cy="15.5" r="3.5" />
      <circle cx="17.5" cy="15.5" r="3.5" />
      <path d="M10 15.5h4" />
      <path d="M3.5 13.5 6 9h3l1 3" />
      <path d="M20.5 13.5 18 9h-3l-1 3" />
    </template>

    <!-- Grimpeur en prise -->
    <template v-else-if="name === 'climbers'">
      <circle cx="11" cy="6" r="2" />
      <path d="M16 3v6" />
      <path d="M11 8.5 8.5 11l1.5 3-2.5 4" />
      <path d="M11 8.5 14 9l2-2" />
      <path d="M10 14l3.5 1 1 4.5" />
      <path d="M8.5 11 6 12.5" />
    </template>

    <!-- Loupe -->
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </template>

    <!-- Sommet -->
    <template v-else-if="name === 'peak'">
      <path d="M3 19 9.5 7l3.5 6 2-3 6 9z" />
      <path d="M9.5 7l1.5 2.5L12.5 8" />
    </template>

    <!-- Buste -->
    <template v-else>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </template>
  </svg>
</template>
