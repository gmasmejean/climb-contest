<script setup lang="ts">
import { Tabs } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, watchEffect } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { competitionsApi } from '../../api/competitions'
import BrandShell from '../../components/brand/BrandShell.vue'
import OrganizerMenu from '../../components/brand/OrganizerMenu.vue'
import { DESKTOP_QUERY, useMediaQuery } from '../../composables/useMediaQuery'
import {
  competitionTabs,
  DEFAULT_COMPETITION_TAB,
  resolveCompetitionTab,
} from '../../lib/competition-tabs'
import CategoriesTab from './tabs/CategoriesTab.vue'
import CompetitorsTab from './tabs/CompetitorsTab.vue'
import ExportsTab from './tabs/ExportsTab.vue'
import InfosTab from './tabs/InfosTab.vue'
import JudgesTab from './tabs/JudgesTab.vue'
import PilotageTab from './tabs/PilotageTab.vue'
import ReadinessTab from './tabs/ReadinessTab.vue'
import RoundsTab from './tabs/RoundsTab.vue'
import RoutesTab from './tabs/RoutesTab.vue'

const route = useRoute()
const router = useRouter()
const competitionId = computed(() => String(route.params.id))

const { data: competition } = useQuery({
  queryKey: ['competitions', competitionId],
  queryFn: () => competitionsApi.get(competitionId.value),
})

const tabs = computed(() => competitionTabs(competition.value?.format))

function tabLocation(tab: string) {
  return {
    name: 'competition-detail',
    params: { id: competitionId.value, tab: tab === DEFAULT_COMPETITION_TAB ? '' : tab },
  }
}

// L'onglet vit dans l'URL (ADR-072). `push` et non `replace` : « précédent »
// ramène à l'onglet d'avant. La query (`?section=` du pilotage) ne suit pas.
const activeTab = computed({
  get: () => resolveCompetitionTab(route.params.tab, competition.value?.format),
  set: (tab: string) => void router.push(tabLocation(tab)),
})

// Segment valide mais sans objet pour cette compétition (`rounds` hors phases) :
// on corrige l'adresse plutôt que d'afficher Infos sous une URL qui dit Tours.
watchEffect(() => {
  const segment = route.params.tab
  if (typeof segment === 'string' && segment !== '' && segment !== activeTab.value) {
    void router.replace(tabLocation(activeTab.value))
  }
})

const isDesktop = useMediaQuery(DESKTOP_QUERY)

const startsOn = computed(() =>
  competition.value
    ? new Date(`${competition.value.startsOn}T00:00:00`).toLocaleDateString('fr-FR', {
        dateStyle: 'long',
      })
    : '',
)
</script>

<template>
  <BrandShell width="wide">
    <template #actions>
      <OrganizerMenu />
    </template>
    <main class="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col px-4 pb-8 lg:px-8">
      <!--
        Collant à partir de `lg` seulement : sur un téléphone il mangerait la
        hauteur utile. Une seule ligne sur grand écran, d'où `lg:truncate`.
      -->
      <header
        class="bg-paper z-20 flex flex-col gap-1 py-4 lg:sticky lg:top-0 lg:flex-row lg:items-center lg:gap-6 lg:border-b lg:border-gray-200"
      >
        <div class="flex min-w-0 flex-col lg:flex-1 lg:flex-row lg:items-baseline lg:gap-4">
          <RouterLink
            :to="{ name: 'competition-list' }"
            class="inline-flex min-h-12 w-fit shrink-0 items-center text-sm font-medium text-blue-700 hover:underline lg:min-h-0"
          >
            ← Mes compétitions
          </RouterLink>
          <h1
            class="font-display text-ink text-3xl leading-none font-bold md:text-4xl lg:truncate lg:pb-1"
          >
            {{ competition?.name }}
          </h1>
        </div>
        <p v-if="competition" class="text-sm text-gray-600 lg:shrink-0 lg:text-right">
          {{ competition.venue }}<span class="hidden lg:inline"> · {{ startsOn }}</span>
        </p>
        <a
          v-if="competition"
          :href="`/c/${competition.publicSlug}`"
          target="_blank"
          rel="noopener"
          class="hidden min-h-12 shrink-0 items-center text-sm font-medium text-blue-700 hover:underline lg:inline-flex"
        >
          Page publique ↗
        </a>
      </header>

      <div
        class="flex flex-col gap-6 pt-2 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:pt-6"
      >
        <aside class="lg:sticky lg:top-24 lg:self-start">
          <Tabs
            v-model="activeTab"
            :tabs="tabs"
            :orientation="isDesktop ? 'vertical' : 'horizontal'"
          />
        </aside>

        <!--
          L'en-tête des tableaux du Lot 18 se colle SOUS l'en-tête de compétition,
          qui est lui-même collant à `lg:top-0`. Une seule variable, posée ici :
          si cet en-tête grandit, il n'y a qu'un endroit à corriger. `6rem` =
          `top-24`, la même valeur que la barre latérale.
        -->
        <div v-if="competition" class="min-w-0" style="--datalist-top: 6rem">
          <InfosTab v-if="activeTab === 'infos'" :competition="competition" />
          <CategoriesTab v-else-if="activeTab === 'categories'" :competition-id="competitionId" />
          <CompetitorsTab v-else-if="activeTab === 'competitors'" :competition-id="competitionId" />
          <RoutesTab v-else-if="activeTab === 'routes'" :competition-id="competitionId" />
          <RoundsTab v-else-if="activeTab === 'rounds'" :competition-id="competitionId" />
          <JudgesTab v-else-if="activeTab === 'judges'" :competition="competition" />
          <ReadinessTab v-else-if="activeTab === 'readiness'" :competition-id="competitionId" />
          <PilotageTab v-else-if="activeTab === 'pilotage'" :competition="competition" />
          <ExportsTab v-else-if="activeTab === 'exports'" :competition="competition" />
        </div>
      </div>
    </main>
  </BrandShell>
</template>
