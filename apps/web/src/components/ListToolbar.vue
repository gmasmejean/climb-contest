<script setup lang="ts">
/**
 * Barre d'outils d'une liste organisateur (Lot 18). Recherche et filtres à
 * gauche, actions à droite : empilées sous 1024 px, sur une seule ligne
 * au-dessus (ADR-072 — tout est additif à partir de `lg`).
 *
 * Elle vit dans `apps/web` et non dans `packages/ui` : elle porte le seuil de
 * 1024 px, qui est une décision de l'application, pas du composant.
 *
 * `items-end` aligne les champs entre eux malgré leurs étiquettes au-dessus.
 * Les largeurs se posent sur un `<div>` englobant côté appelant (`lg:w-72`) :
 * `TextField` et `Select` ont une racine en colonne et prennent la largeur
 * qu'on leur donne.
 */
</script>

<template>
  <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
    <div class="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <slot />
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
