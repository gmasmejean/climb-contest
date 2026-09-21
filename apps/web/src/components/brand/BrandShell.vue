<script setup lang="ts">
import '../../brand-fonts'

import { RouterLink } from 'vue-router'

import wallLeft from '../../assets/landing/wall-left.webp'
import wallNarrow from '../../assets/landing/wall-narrow.webp'
import wallRight from '../../assets/landing/wall-right.webp'
import BrandLogo from './BrandLogo.vue'

/**
 * Coque des pages hors notation (ADR-071) : polices de la charte, fond papier,
 * en-tête avec le logo. `decor` ajoute le mur aquarelle — réservé aux pages
 * d'entrée (connexion, inscription, accès juge, page publique), jamais aux
 * écrans de travail denses.
 *
 * La page fournit son propre `<main>` dans le slot ; il doit porter `flex-1`
 * (et non `min-h-dvh`) pour occuper la hauteur restante sous l'en-tête.
 */
withDefaults(defineProps<{ decor?: boolean }>(), { decor: false })
</script>

<template>
  <div class="bg-paper font-body text-ink relative flex min-h-dvh flex-col overflow-x-hidden">
    <template v-if="decor">
      <!--
        Décor, sous le contenu, jamais lu par les lecteurs d'écran. Sur mobile :
        un bandeau à hauteur de l'en-tête seulement, jamais sous un titre.
      -->
      <img
        :src="wallNarrow"
        alt=""
        aria-hidden="true"
        class="pointer-events-none absolute top-0 right-0 z-0 h-24 w-[45%] max-w-56 mask-b-from-40% mask-l-from-60% object-cover object-[50%_12%] md:hidden"
      />
      <img
        :src="wallLeft"
        alt=""
        aria-hidden="true"
        loading="lazy"
        class="pointer-events-none absolute top-0 left-0 z-0 hidden h-[72vh] w-[18vw] max-w-72 mask-t-from-90% mask-r-from-55% mask-b-from-70% object-cover object-right-top md:block"
      />
      <img
        :src="wallRight"
        alt=""
        aria-hidden="true"
        loading="lazy"
        class="pointer-events-none absolute top-0 right-0 z-0 hidden h-[72vh] w-[18vw] max-w-72 mask-t-from-90% mask-b-from-70% mask-l-from-55% object-cover object-left-top md:block"
      />
    </template>

    <header
      class="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-4 md:px-8 md:pt-6"
    >
      <RouterLink
        to="/"
        aria-label="Climb Contest — accueil"
        class="focus-visible:outline-navy inline-flex min-h-12 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <BrandLogo />
      </RouterLink>
      <slot name="actions" />
    </header>

    <div class="relative z-10 flex flex-1 flex-col">
      <slot />
    </div>
  </div>
</template>
