<script setup lang="ts">
import type { Competition } from '@climbcontest/contracts'
import { Tabs } from '@climbcontest/ui'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PilotageActivityLog from '../pilotage/PilotageActivityLog.vue'
import PilotageAscents from '../pilotage/PilotageAscents.vue'
import PilotageConflicts from '../pilotage/PilotageConflicts.vue'
import PilotageOverview from '../pilotage/PilotageOverview.vue'
import PilotageRounds from '../pilotage/PilotageRounds.vue'

defineProps<{ competition: Competition }>()

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
    <div data-testid="pilotage-sections">
      <Tabs v-model="section" :tabs="sections" />
    </div>
    <PilotageOverview v-if="section === 'overview'" :competition-id="competition.id" />
    <PilotageRounds
      v-else-if="section === 'rounds'"
      :competition-id="competition.id"
      :format="competition.format"
    />
    <PilotageAscents v-else-if="section === 'ascents'" :competition-id="competition.id" />
    <PilotageConflicts v-else-if="section === 'conflicts'" :competition-id="competition.id" />
    <PilotageActivityLog v-else-if="section === 'activity-log'" :competition-id="competition.id" />
  </div>
</template>
