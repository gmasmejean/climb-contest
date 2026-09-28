<script setup lang="ts">
import { Badge, Select, Tabs } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { publicApi, publicQueryKeys } from '../../api/public'
import { usePublicCategoryPreference } from '../../composables/usePublicCategoryPreference'
import {
  usePublicStream,
  type PublicStreamConnectionState,
} from '../../composables/usePublicStream'
import PublicRanking from './PublicRanking.vue'
import PublicRoutes from './PublicRoutes.vue'
import BrandShell from '../../components/brand/BrandShell.vue'
import LocationMap from '../../components/LocationMap.vue'
import OrganizationCard from '../../components/OrganizationCard.vue'
import { samePlace } from '../../lib/competition-place'
import { galleryPhotos, publicPhotoUrl } from '../../lib/organization-photos'

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const categoryPreference = usePublicCategoryPreference(slug.value)
const queryClient = useQueryClient()

const {
  data: meta,
  isPending,
  isError,
} = useQuery({
  queryKey: computed(() => publicQueryKeys.meta(slug.value)),
  queryFn: () => publicApi.meta(slug.value),
  refetchOnWindowFocus: false,
})

// ADR-090 : les photos de l'organisation se lisent par la compétition affichée.
const organizationPhotos = computed(() =>
  meta.value
    ? galleryPhotos(meta.value.organization.photos, meta.value.organization.name, (id) =>
        publicPhotoUrl(slug.value, id),
      )
    : [],
)

const selectedCategoryId = ref<string>(categoryPreference.get() ?? '')
watch(
  meta,
  (value) => {
    if (!value) return
    const stillValid = value.categories.some((c) => c.id === selectedCategoryId.value)
    if (!stillValid) {
      selectedCategoryId.value = value.categories[0]?.id ?? ''
    }
  },
  { immediate: true },
)
watch(selectedCategoryId, (categoryId) => {
  if (categoryId) categoryPreference.set(categoryId)
})

const activeTab = ref('ranking')
const tabs = [
  { id: 'ranking', label: 'Classement' },
  { id: 'routes', label: 'Voies' },
]

const roundStatusLabels: Record<string, string> = {
  draft: 'à venir',
  open: 'en cours',
  closed: 'clôturé',
  published: 'publié',
}

// ADR-065 : l'état d'un tour se lit pour la catégorie affichée — les U16 peuvent
// avoir fini leur qualification quand les U18 n'ont pas commencé.
const roundBadges = computed(() =>
  (meta.value?.rounds ?? []).flatMap((round) => {
    const pair = round.categories.find((c) => c.categoryId === selectedCategoryId.value)
    return pair ? [{ id: round.id, type: round.type, status: pair.status }] : []
  }),
)

const connectionState = ref<PublicStreamConnectionState>('connecting')
const lastUpdatedAt = ref<Date | null>(null)

function refetchAll(): void {
  void queryClient.invalidateQueries({ queryKey: publicQueryKeys.meta(slug.value) })
  void queryClient.invalidateQueries({ queryKey: ['public-rankings', slug.value] })
  void queryClient.invalidateQueries({ queryKey: ['public-routes', slug.value] })
}

const stream = usePublicStream(
  slug.value,
  {
    onEvent(event) {
      if (event.type === 'ranking_updated') {
        void queryClient.invalidateQueries({
          queryKey: publicQueryKeys.rankings(slug.value, event.categoryId),
        })
      } else if (event.type === 'route_updated') {
        void queryClient.invalidateQueries({ queryKey: ['public-routes', slug.value] })
      } else {
        void queryClient.invalidateQueries({ queryKey: publicQueryKeys.meta(slug.value) })
        void queryClient.invalidateQueries({ queryKey: ['public-rankings', slug.value] })
      }
    },
    onStateChange(state) {
      connectionState.value = state
    },
    onHeartbeat() {
      lastUpdatedAt.value = new Date()
    },
    onPoll: refetchAll,
  },
  {},
)

onMounted(() => stream.start())
onUnmounted(() => stream.stop())

const lastUpdatedLabel = computed(() => {
  if (!lastUpdatedAt.value) return null
  return lastUpdatedAt.value.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
})
</script>

<template>
  <BrandShell decor>
    <main class="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-6">
      <p v-if="isPending" class="text-gray-600">Chargement…</p>
      <p v-else-if="isError" role="alert" class="text-red-700">
        Impossible de charger cette compétition.
      </p>

      <template v-else-if="meta">
        <header class="flex flex-col gap-1">
          <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
            {{ meta.competition.name }}
          </h1>
          <p class="text-sm text-gray-600">
            {{ meta.competition.venue }} — {{ meta.competition.startsOn }}
          </p>
          <p v-if="meta.competition.address" class="text-sm text-gray-600">
            {{ meta.competition.address.label }}
          </p>
          <div role="status" class="flex items-center gap-2 text-xs text-gray-600">
            <span
              class="h-2 w-2 rounded-full"
              :class="connectionState === 'open' ? 'bg-green-600' : 'animate-pulse bg-amber-600'"
              aria-hidden="true"
            />
            <span v-if="connectionState === 'open'">En direct</span>
            <span v-else>Reconnexion…</span>
            <span v-if="lastUpdatedLabel">— dernière mise à jour à {{ lastUpdatedLabel }}</span>
          </div>
        </header>

        <div v-if="roundBadges.length > 0" class="flex flex-wrap gap-2">
          <Badge v-for="round in roundBadges" :key="round.id" tone="neutral">
            {{
              round.type === 'qualification'
                ? 'Qualification'
                : round.type === 'semifinal'
                  ? 'Demi-finale'
                  : 'Finale'
            }}
            : {{ roundStatusLabels[round.status] ?? round.status }}
          </Badge>
        </div>

        <Select
          v-if="meta.categories.length > 0"
          v-model="selectedCategoryId"
          label="Catégorie"
          :options="meta.categories.map((c) => ({ value: c.id, label: c.label }))"
        />
        <p v-else class="text-gray-600">Aucune catégorie n'est encore configurée.</p>

        <Tabs v-model="activeTab" :tabs="tabs" />

        <PublicRanking
          v-if="activeTab === 'ranking' && selectedCategoryId"
          :slug="slug"
          :category-id="selectedCategoryId"
          :format="meta.competition.format"
        />
        <PublicRoutes
          v-else-if="activeTab === 'routes' && selectedCategoryId"
          :slug="slug"
          :category-id="selectedCategoryId"
        />

        <!-- ADR-089 : le lieu, puis l'organisation (ADR-088), sous les résultats que
             le spectateur vient voir d'abord. -->
        <section
          v-if="meta.competition.address"
          aria-labelledby="place-title"
          class="mt-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
          data-testid="competition-place"
        >
          <h2 id="place-title" class="text-ink text-xl font-bold">Lieu</h2>
          <p class="font-medium text-gray-900">{{ meta.competition.venue }}</p>
          <LocationMap :address="meta.competition.address" />
        </section>
        <OrganizationCard
          :organization="meta.organization"
          eyebrow="Organisé par"
          :photos="organizationPhotos"
          :hide-location="samePlace(meta.competition.address, meta.organization.address)"
          :class="meta.competition.address ? '' : 'mt-4'"
        />
      </template>
    </main>
  </BrandShell>
</template>
