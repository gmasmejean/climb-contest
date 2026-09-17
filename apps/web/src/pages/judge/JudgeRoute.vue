<script setup lang="ts">
import type { JudgeLastAscent, JudgeRouteDetail } from '@climbcontest/contracts'
import { SyncStatusIndicator, Tabs, TextField } from '@climbcontest/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { judgeAscentsApi, judgeRoutesApi } from '../../api/judge-ascents'
import { useWakeLock } from '../../composables/useWakeLock'
import { useAscentRowState } from '../../judge/useAscentRowState'

useWakeLock()

const route = useRoute()
const routeId = String(route.params.routeId ?? '')
const rowState = useAscentRowState()

const detail = ref<JudgeRouteDetail | 'loading' | 'error'>('loading')
const last = ref<JudgeLastAscent>(null)
const search = ref('')
const activeTab = ref<'todo' | 'done'>('todo')
const nowMs = ref(Date.now())

async function load(): Promise<void> {
  detail.value = 'loading'
  try {
    const [detailResponse, lastResponse] = await Promise.all([
      judgeRoutesApi.detail(routeId),
      judgeAscentsApi.last(),
    ])
    detail.value = detailResponse
    last.value = lastResponse
  } catch {
    detail.value = 'error'
  }
}

onMounted(load)

let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})

function summarize(a: {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
}): string {
  if (a.status === 'dns') return 'DNS'
  if (a.status === 'dnf') return 'DNF'
  if (a.status === 'dsq') return 'DSQ'
  if (a.isTop) return 'TOP'
  return `prise ${a.holdNumber}${a.modifier === 'plus' ? '+' : ''}`
}

interface DisplayCompetitor {
  id: string
  bib: number | null
  firstName: string
  lastName: string
  categoryLabel: string
  done: boolean
  syncStatus: 'syncing' | 'synced' | 'error' | null
  canCorrect: boolean
  summary: string
  retry?: (() => void) | undefined
}

const displayCompetitors = computed<DisplayCompetitor[]>(() => {
  if (detail.value === 'loading' || detail.value === 'error') return []
  return detail.value.competitors.map((c) => {
    const overlay = rowState.get(c.id)
    if (overlay) {
      return {
        id: c.id,
        bib: c.bib,
        firstName: c.firstName,
        lastName: c.lastName,
        categoryLabel: c.categoryLabel,
        done: true,
        syncStatus: overlay.status,
        // Fondé sur la fenêtre connue côté client dès la soumission — ne
        // dépend pas du `GET /judge/ascents/last`, qui a pu partir avant que
        // cette écriture n'ait abouti côté serveur (voir useAscentRowState.ts).
        canCorrect: rowState.canCorrect(c.id, nowMs.value),
        summary: summarize(overlay.preview),
        retry: overlay.status === 'error' ? overlay.retry : undefined,
      }
    }
    const canCorrect =
      c.ascent !== null &&
      last.value !== null &&
      last.value.ascent.id === c.ascent.id &&
      nowMs.value < new Date(last.value.correctableUntil).getTime()
    return {
      id: c.id,
      bib: c.bib,
      firstName: c.firstName,
      lastName: c.lastName,
      categoryLabel: c.categoryLabel,
      done: c.ascent !== null,
      syncStatus: c.ascent !== null ? ('synced' as const) : null,
      canCorrect,
      summary: c.ascent ? summarize(c.ascent) : '',
      retry: undefined,
    }
  })
})

const todoCount = computed(() => displayCompetitors.value.filter((c) => !c.done).length)
const doneCount = computed(() => displayCompetitors.value.filter((c) => c.done).length)

const filtered = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  const list = displayCompetitors.value.filter((c) =>
    activeTab.value === 'done' ? c.done : !c.done,
  )
  if (!term) return list
  return list.filter(
    (c) =>
      `${c.firstName} ${c.lastName}`.toLocaleLowerCase().includes(term) ||
      String(c.bib ?? '').includes(term),
  )
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 px-4 py-8">
    <RouterLink
      :to="{ name: 'judge-home' }"
      class="text-sm font-medium text-blue-700 hover:underline"
    >
      ← Vos voies
    </RouterLink>

    <template v-if="detail === 'loading'">
      <p class="text-gray-600">Chargement…</p>
    </template>

    <template v-else-if="detail === 'error'">
      <h1 class="text-xl font-bold text-gray-900">Voie indisponible</h1>
      <p class="text-gray-700">Impossible de charger cette voie — réessayez.</p>
    </template>

    <template v-else>
      <h1 class="text-2xl font-bold text-gray-900">
        Voie {{ detail.route.number
        }}<template v-if="detail.route.name"> — {{ detail.route.name }}</template>
      </h1>
      <p class="text-sm text-gray-600">{{ detail.route.holdCount }} prises</p>

      <p v-if="detail.round === null" class="rounded-lg bg-amber-100 px-4 py-3 text-amber-900">
        Aucun tour ouvert sur cette voie pour l'instant.
      </p>

      <template v-else>
        <TextField v-model="search" label="Rechercher" hint="Dossard ou nom" />

        <Tabs
          v-model="activeTab"
          :tabs="[
            { id: 'todo', label: `À faire (${todoCount})` },
            { id: 'done', label: `Fait (${doneCount})` },
          ]"
        />

        <ul class="flex flex-col gap-2">
          <li v-for="c in filtered" :key="c.id">
            <RouterLink
              v-if="!c.done"
              :to="{ name: 'judge-ascent-entry', params: { routeId, competitorId: c.id } }"
              class="flex min-h-16 items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <div class="flex flex-col">
                <span class="font-medium text-gray-900">
                  Dossard {{ c.bib ?? '—' }} — {{ c.firstName }} {{ c.lastName }}
                </span>
                <span class="text-sm text-gray-600">{{ c.categoryLabel }}</span>
              </div>
            </RouterLink>

            <div v-else class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3">
              <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col">
                  <span class="font-medium text-gray-900">
                    Dossard {{ c.bib ?? '—' }} — {{ c.firstName }} {{ c.lastName }}
                  </span>
                  <span class="text-sm text-gray-600">{{ c.summary }}</span>
                </div>
                <RouterLink
                  v-if="c.canCorrect"
                  :to="{ name: 'judge-ascent-entry', params: { routeId, competitorId: c.id } }"
                  class="min-h-12 shrink-0 text-sm font-medium text-blue-700 hover:underline"
                >
                  Corriger
                </RouterLink>
              </div>
              <div v-if="c.syncStatus === 'error'" class="flex items-center justify-between gap-4">
                <p role="alert" class="text-sm font-medium text-red-700">
                  Échec de l'envoi — la saisie est conservée sur cet écran.
                </p>
                <button
                  type="button"
                  class="min-h-12 shrink-0 text-sm font-medium text-red-700 hover:underline"
                  @click="c.retry?.()"
                >
                  Réessayer
                </button>
              </div>
              <SyncStatusIndicator
                v-else
                :status="c.syncStatus === 'syncing' ? 'syncing' : 'synced'"
              />
              <p v-if="!c.canCorrect && c.syncStatus === 'synced'" class="text-xs text-gray-500">
                Passage déjà confirmé — seul l'organisateur peut le corriger désormais.
              </p>
            </div>
          </li>
          <li v-if="filtered.length === 0" class="text-gray-600">Aucun compétiteur.</li>
        </ul>
      </template>
    </template>
  </main>
</template>
