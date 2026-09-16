<script setup lang="ts">
import { Tabs } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { competitionsApi } from '../../api/competitions'
import CategoriesTab from './tabs/CategoriesTab.vue'
import CompetitorsTab from './tabs/CompetitorsTab.vue'
import InfosTab from './tabs/InfosTab.vue'
import ReadinessTab from './tabs/ReadinessTab.vue'
import RoundsTab from './tabs/RoundsTab.vue'
import RoutesTab from './tabs/RoutesTab.vue'

const route = useRoute()
const competitionId = computed(() => String(route.params.id))

const { data: competition } = useQuery({
  queryKey: ['competitions', competitionId],
  queryFn: () => competitionsApi.get(competitionId.value),
})

const activeTab = ref('infos')
watch(competitionId, () => {
  activeTab.value = 'infos'
})

const tabs = computed(() => {
  const base = [
    { id: 'infos', label: 'Infos' },
    { id: 'categories', label: 'Catégories' },
    { id: 'competitors', label: 'Compétiteurs' },
    { id: 'routes', label: 'Voies' },
  ]
  if (competition.value?.format === 'phases') {
    base.push({ id: 'rounds', label: 'Tours' })
  }
  base.push({ id: 'readiness', label: 'Prêt à démarrer ?' })
  return base
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8">
    <header class="flex flex-col gap-2">
      <RouterLink
        :to="{ name: 'competition-list' }"
        class="inline-flex min-h-12 w-fit items-center text-sm font-medium text-blue-700 hover:underline"
      >
        ← Mes compétitions
      </RouterLink>
      <h1 class="text-2xl font-bold text-gray-900">{{ competition?.name }}</h1>
      <p class="text-sm text-gray-600">{{ competition?.venue }}</p>
    </header>

    <Tabs v-model="activeTab" :tabs="tabs" />

    <div v-if="competition">
      <InfosTab v-if="activeTab === 'infos'" :competition="competition" />
      <CategoriesTab v-else-if="activeTab === 'categories'" :competition-id="competitionId" />
      <CompetitorsTab v-else-if="activeTab === 'competitors'" :competition-id="competitionId" />
      <RoutesTab v-else-if="activeTab === 'routes'" :competition-id="competitionId" />
      <RoundsTab v-else-if="activeTab === 'rounds'" :competition-id="competitionId" />
      <ReadinessTab v-else-if="activeTab === 'readiness'" :competition-id="competitionId" />
    </div>
  </main>
</template>
