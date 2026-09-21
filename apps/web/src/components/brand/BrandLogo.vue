<script setup lang="ts">
/**
 * Logo de la page d'accueil (ADR-070) : pastille sombre avec une silhouette de
 * grimpeur, et le nom en Caveat bold. Le favicon et les icônes PWA
 * gardent l'ancien « CC » pour l'instant (TODO.md).
 */
</script>

<template>
  <div class="flex items-center gap-2.5">
    <svg
      viewBox="0 0 48 48"
      class="size-11 shrink-0 md:size-12"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="24" r="24" class="fill-navy-deep" />
      <g class="fill-white">
        <circle cx="29" cy="11.5" r="3.4" />
        <!-- tronc, bras vers la prise haute, jambe en appui -->
        <path
          d="M26.8 16.2a2.2 2.2 0 0 1 3 .6l3.6 5.6-1 13.4a2 2 0 0 1-4-.3l.8-10.2-3.2-1.8-2.6 4.9 3.2 4.2-4.2 5.8a2 2 0 1 1-3.2-2.4l2.8-3.9-3.6-4.7a2.4 2.4 0 0 1-.2-2.6l4-7.4Z"
        />
        <path d="M32 9.2l5.6-6.2a1.6 1.6 0 0 1 2.4 2.1l-5.4 6.1a1.6 1.6 0 0 1-2.6-2Z" />
      </g>
      <!-- prises -->
      <circle cx="12" cy="30" r="2" class="fill-white/60" />
      <circle cx="38" cy="36" r="1.7" class="fill-white/60" />
      <circle cx="16" cy="12" r="1.5" class="fill-white/60" />
    </svg>
    <span class="font-display text-ink text-2xl leading-[0.9] font-bold md:text-3xl">
      Climb<br />Contest
    </span>
  </div>
</template>
