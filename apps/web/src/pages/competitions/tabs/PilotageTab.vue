<script setup lang="ts">
import type { Competition } from '@climbcontest/contracts'
import { Tabs } from '@climbcontest/ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { CompetitionPulse } from '../../../composables/useCompetitionPulse'
import PilotageActivityLog from '../pilotage/PilotageActivityLog.vue'
import PilotageAscents from '../pilotage/PilotageAscents.vue'
import PilotageConflicts from '../pilotage/PilotageConflicts.vue'
import PilotageOverview from '../pilotage/PilotageOverview.vue'
import PilotageRounds from '../pilotage/PilotageRounds.vue'

defineProps<{ competition: Competition; pulse: CompetitionPulse }>()

const sections = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'rounds', label: 'Tours' },
  { id: 'ascents', label: 'Voies' },
  { id: 'conflicts', label: 'Conflits' },
  { id: 'activity-log', label: 'Journal' },
]

// La sous-section vit dans l'URL, comme l'onglet (ADR-072) : `?section=conflicts`
// se recharge, se partage, et « précédent » y revient. Valeur inconnue ou
// absente : vue d'ensemble, sans paramètre.
const route = useRoute()
const router = useRouter()
const section = computed({
  get: () => {
    const requested = route.query.section
    return sections.some((candidate) => candidate.id === requested) ? String(requested) : 'overview'
  },
  set: (id: string) => {
    const query = { ...route.query }
    delete query.section
    void router.push({ query: id === 'overview' ? query : { ...query, section: id } })
  },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!--
      Bandeau d'état du serveur (Lot 20). Il vivait dans « Vue d'ensemble » :
      depuis Conflits ou Journal, l'organisateur lisait des chiffres périmés
      sans aucun avertissement. Ici, il couvre les cinq sections.
      Non collant : l'en-tête de compétition l'est déjà à partir de `lg`, et
      une troisième couche collante mangerait la hauteur utile.
    -->
    <p
      v-if="pulse.isStale.value"
      role="alert"
      data-testid="pilotage-server-banner"
      class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <strong>Le serveur ne répond plus.</strong> Ce que vous voyez date de
      {{ pulse.lastUpdate.value }} : ne vous y fiez pas pour les alertes. Tout se remettra à jour
      dès que la connexion revient ; les saisies des juges, elles, sont conservées sur leurs
      téléphones.
    </p>
    <div data-testid="pilotage-sections">
      <Tabs v-model="section" :tabs="sections" />
    </div>
    <PilotageOverview
      v-if="section === 'overview'"
      :competition-id="competition.id"
      :pulse="pulse"
      @open="section = $event"
    />
    <PilotageRounds
      v-else-if="section === 'rounds'"
      :competition-id="competition.id"
      :format="competition.format"
    />
    <PilotageAscents
      v-else-if="section === 'ascents'"
      :competition-id="competition.id"
      @open="section = $event"
    />
    <PilotageConflicts v-else-if="section === 'conflicts'" :competition-id="competition.id" />
    <PilotageActivityLog v-else-if="section === 'activity-log'" :competition-id="competition.id" />
  </div>
</template>
