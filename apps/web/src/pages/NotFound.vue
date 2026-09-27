<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { useRoute } from 'vue-router'

import BrandShell from '../components/brand/BrandShell.vue'

/**
 * Adresse qui ne correspond à aucune route : sans elle, l'application
 * affichait une page blanche (constaté en production, TODO.md § Lot 22).
 * Aucune requête réseau : la page doit s'afficher même hors ligne.
 */
const route = useRoute()
</script>

<template>
  <BrandShell decor>
    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-8">
      <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
        Page introuvable
      </h1>
      <p class="text-base">
        L’adresse <code class="font-mono text-sm break-all">{{ route.path }}</code> ne correspond à
        aucune page. Vérifiez qu’elle est recopiée sans erreur, ou repartez de l’accueil.
      </p>
      <p class="text-sm text-gray-700">
        Vous l’avez reçue d’un organisateur (lien de juge, classement) ? Demandez-lui de vous la
        renvoyer.
      </p>
      <Button to="/" full-width>Retour à l’accueil</Button>
    </main>
  </BrandShell>
</template>
