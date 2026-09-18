<script setup lang="ts">
import type { Competition } from '@climbcontest/contracts'
import { Tabs } from '@climbcontest/ui'
import { ref } from 'vue'

import PilotageActivityLog from '../pilotage/PilotageActivityLog.vue'
import PilotageAscents from '../pilotage/PilotageAscents.vue'
import PilotageConflicts from '../pilotage/PilotageConflicts.vue'
import PilotageOverview from '../pilotage/PilotageOverview.vue'
import PilotageRounds from '../pilotage/PilotageRounds.vue'

defineProps<{ competition: Competition }>()

const section = ref('overview')
const sections = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'rounds', label: 'Tours' },
  { id: 'ascents', label: 'Voies' },
  { id: 'conflicts', label: 'Conflits' },
  { id: 'activity-log', label: 'Journal' },
]
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
