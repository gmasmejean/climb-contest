<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { useId } from 'vue'

import RoleIcon from './RoleIcon.vue'

/**
 * Recherche publique de compétitions — prévue au Lot 13 (ROADMAP.md), qui
 * n'est pas engagé : aucune liste publique n'existe côté serveur. Le bloc est
 * présent comme sur la maquette mais DÉSACTIVÉ et le dit (CLAUDE.md « rien de
 * simulé » : jamais un champ qui accepte du texte et ne fait rien). Le Lot 13
 * retire `disabled` et la mention, et branche la page de résultats (ADR-070).
 */
const id = useId()
const hintId = `${id}-hint`
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-3 md:flex-row">
      <div class="relative flex-1">
        <label :for="id" class="sr-only">Rechercher une compétition</label>
        <RoleIcon
          name="search"
          class="text-ink pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
        />
        <input
          :id="id"
          type="search"
          disabled
          placeholder="Rechercher une compétition…"
          :aria-describedby="hintId"
          class="border-navy/40 text-ink min-h-12 w-full rounded-full border bg-white pr-4 pl-12 text-base placeholder:text-gray-600 disabled:cursor-not-allowed"
        />
      </div>
      <Button disabled>
        <RoleIcon name="peak" class="size-5" />
        Trouver une compétition
      </Button>
    </div>
    <p :id="hintId" class="text-sm text-gray-700">
      Recherche bientôt disponible. En attendant, ouvrez le lien ou le QR code partagé par
      l’organisateur.
    </p>
  </div>
</template>
