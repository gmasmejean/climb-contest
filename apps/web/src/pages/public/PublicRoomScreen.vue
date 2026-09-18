<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, onUnmounted, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { publicApi, publicQueryKeys } from '../../api/public'
import { usePublicStream } from '../../composables/usePublicStream'

/** Durée d'affichage d'une catégorie avant de passer à la suivante (ROADMAP.md Lot 7 : « défile… en boucle »). */
const CYCLE_MS = 10_000

const route = useRoute()
const slug = computed(() => String(route.params.slug))
const queryClient = useQueryClient()

const { data: meta } = useQuery({
  queryKey: computed(() => publicQueryKeys.meta(slug.value)),
  queryFn: () => publicApi.meta(slug.value),
  refetchOnWindowFocus: false,
})

const currentIndex = ref(0)
const currentCategory = computed(() => {
  const categories = meta.value?.categories ?? []
  if (categories.length === 0) return null
  return categories[currentIndex.value % categories.length] ?? null
})

let cycleTimer: ReturnType<typeof setInterval> | undefined
watch(
  () => meta.value?.categories.length ?? 0,
  (length) => {
    clearInterval(cycleTimer)
    cycleTimer = undefined
    if (length > 1) {
      cycleTimer = setInterval(() => {
        currentIndex.value = (currentIndex.value + 1) % length
      }, CYCLE_MS)
    }
  },
)
onUnmounted(() => clearInterval(cycleTimer))

const { data: ranking } = useQuery({
  queryKey: computed(() => publicQueryKeys.rankings(slug.value, currentCategory.value?.id ?? '')),
  queryFn: () => publicApi.rankings(slug.value, currentCategory.value?.id ?? ''),
  enabled: computed(() => currentCategory.value !== null),
  refetchOnWindowFocus: false,
})

const isFullscreen = ref(Boolean(document.fullscreenElement))
document.addEventListener('fullscreenchange', () => {
  isFullscreen.value = Boolean(document.fullscreenElement)
})

async function toggleFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch {
    // Best-effort : l'API Fullscreen exige un geste utilisateur et peut être
    // refusée par le navigateur/contexte — l'écran reste utilisable sans.
  }
}

const stream = usePublicStream(slug.value, {
  onEvent(event) {
    if (event.type === 'ranking_updated') {
      void queryClient.invalidateQueries({
        queryKey: publicQueryKeys.rankings(slug.value, event.categoryId),
      })
    }
  },
  onPoll() {
    if (currentCategory.value) {
      void queryClient.invalidateQueries({
        queryKey: publicQueryKeys.rankings(slug.value, currentCategory.value.id),
      })
    }
  },
})
onMounted(() => stream.start())
onUnmounted(() => stream.stop())
</script>

<template>
  <main class="flex min-h-dvh flex-col bg-gray-950 p-8 text-white">
    <button
      v-if="!isFullscreen"
      type="button"
      class="mb-4 min-h-12 w-fit rounded-lg bg-white/10 px-4 text-base font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      @click="toggleFullscreen"
    >
      Plein écran
    </button>

    <template v-if="currentCategory">
      <h1 class="text-5xl font-bold">{{ currentCategory.label }}</h1>
      <p v-if="ranking?.provisional" class="mt-2 text-2xl text-amber-400">Classement provisoire</p>

      <ol v-if="ranking && ranking.entries.length > 0" class="mt-8 flex flex-col gap-3">
        <li
          v-for="entry in ranking.entries.slice(0, 10)"
          :key="`${entry.rank}-${entry.bib ?? entry.lastName}`"
          class="flex items-baseline gap-6 border-b border-white/10 pb-3"
        >
          <span class="w-20 text-right text-6xl font-black tabular-nums">{{ entry.rank }}</span>
          <span class="flex-1 text-4xl font-semibold">{{ entry.firstName }} {{ entry.lastName }}</span>
          <span v-if="entry.club" class="text-2xl text-gray-300">{{ entry.club }}</span>
        </li>
      </ol>
      <p v-else class="mt-8 text-3xl text-gray-400">Classement pas encore disponible.</p>
    </template>
    <p v-else class="text-3xl text-gray-400">Aucune catégorie à afficher.</p>
  </main>
</template>
