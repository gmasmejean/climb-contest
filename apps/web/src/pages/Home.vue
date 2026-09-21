<script setup lang="ts">
// Polices auto-hébergées (OFL), importées ICI et non dans `style.css` : elles
// partent dans le chunk de la page d'accueil, les écrans juge ne les
// téléchargent jamais (ADR-070).
import '@fontsource/caveat-brush'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'

import { computed } from 'vue'

import { judgeToken } from '../api/judge-session'
import { currentUser } from '../api/session'
import crowdNarrow from '../assets/landing/crowd-narrow.webp'
import crowdWide from '../assets/landing/crowd-wide.webp'
import wallLeft from '../assets/landing/wall-left.webp'
import wallNarrow from '../assets/landing/wall-narrow.webp'
import wallRight from '../assets/landing/wall-right.webp'
import LandingHeader from '../components/landing/LandingHeader.vue'
import LandingSearch from '../components/landing/LandingSearch.vue'
import RoleCard from '../components/landing/RoleCard.vue'
import RoleIcon from '../components/landing/RoleIcon.vue'

// Un organisateur connecté qui cliquerait « Connexion » serait renvoyé ici par
// la garde `guestOnly` : on l'emmène directement à ses compétitions.
const organizersTarget = computed(() =>
  currentUser.value ? { name: 'competition-list' } : { name: 'login' },
)

// Les juges n'ont pas de compte (SPEC.md § 3.2) : la carte ne mène quelque
// part que si un accès juge existe déjà sur cet appareil.
const judgesTarget = computed(() => (judgeToken.value ? { name: 'judge-home' } : undefined))
</script>

<template>
  <div class="bg-paper font-body text-ink relative flex min-h-dvh flex-col overflow-x-hidden">
    <!-- Décor : mur d'escalade, sous le contenu, jamais lu par les lecteurs d'écran. -->
    <img
      :src="wallNarrow"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute top-0 right-0 z-0 w-[56%] max-w-xs mask-b-from-60% mask-l-from-80% md:hidden"
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

    <main class="relative z-10 mx-auto w-full max-w-6xl px-4 pt-4 md:px-8 md:pt-6">
      <LandingHeader />

      <section class="mt-10 max-w-[60%] md:mx-auto md:mt-14 md:max-w-2xl md:text-center">
        <h1 class="font-display text-5xl leading-[0.95] md:text-6xl">
          Découvrir.<br class="md:hidden" />
          Suivre.<br class="md:hidden" />
          Vivre.
        </h1>
        <p class="mt-4 text-lg leading-snug md:text-xl">
          Climb Contest relie grimpeurs, organisateurs, juges et spectateurs pour des compétitions
          inoubliables.
        </p>
      </section>

      <LandingSearch class="mt-8 md:mx-auto md:mt-10 md:max-w-3xl" />

      <ul
        class="mt-8 grid grid-cols-2 gap-3 md:mx-auto md:mt-10 md:max-w-5xl md:grid-cols-4 md:gap-5"
      >
        <RoleCard
          tone="yellow"
          title="Organisateurs"
          text="Créez et gérez une compétition."
          :to="organizersTarget"
        >
          <template #icon><RoleIcon name="organizers" class="size-10 md:size-12" /></template>
        </RoleCard>
        <RoleCard
          tone="green"
          title="Juges"
          text="Scannez le QR code remis par l’organisateur."
          :to="judgesTarget"
        >
          <template #icon><RoleIcon name="judges" class="size-10 md:size-12" /></template>
        </RoleCard>
        <RoleCard
          tone="blue"
          title="Spectateurs"
          text="Suivez le classement en direct depuis le lien ou le QR code partagé par l’organisateur."
        >
          <template #icon><RoleIcon name="spectators" class="size-10 md:size-12" /></template>
        </RoleCard>
        <RoleCard
          tone="purple"
          title="Grimpeurs"
          text="Inscrivez-vous aux compétitions."
          badge="Bientôt"
        >
          <template #icon><RoleIcon name="climbers" class="size-10 md:size-12" /></template>
        </RoleCard>
      </ul>
    </main>

    <!-- Foule : dans le flux, poussée en bas de page — jamais sous les cartes. -->
    <picture aria-hidden="true" class="pointer-events-none mt-10 block w-full md:mt-12">
      <source media="(min-width: 768px)" :srcset="crowdWide" />
      <img
        :src="crowdNarrow"
        alt=""
        loading="lazy"
        decoding="async"
        class="h-36 w-full object-cover object-top md:h-60"
      />
    </picture>
  </div>
</template>
