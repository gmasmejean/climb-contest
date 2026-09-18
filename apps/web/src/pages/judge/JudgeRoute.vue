<script setup lang="ts">
import { SyncStatusIndicator, Tabs, TextField } from '@climbcontest/ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'

import { useWakeLock } from '../../composables/useWakeLock'
import { useJudgeRouteDetail } from '../../judge/local-store'
import { useAscentRowState } from '../../judge/useAscentRowState'

useWakeLock()

const route = useRoute()
const routeId = String(route.params.routeId ?? '')
const rowState = useAscentRowState()

// Lecture locale seule (ADR-012, SPEC.md § 6.3) : jamais de dépendance
// réseau pour afficher cet écran. `null` tant que le bootstrap n'a pas
// encore chargé cette voie.
const detail = useJudgeRouteDetail(routeId)
const search = ref('')
const activeTab = ref<'todo' | 'done'>('todo')
const nowMs = ref(Date.now())

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
  syncStatus: 'syncing' | 'synced' | 'conflict' | 'rejected' | null
  canCorrect: boolean
  summary: string
  rejectedReason?: string | undefined
  conflictSummary?: { yours: string; other: string } | undefined
}

const displayCompetitors = computed<DisplayCompetitor[]>(() => {
  if (!detail.value) return []
  return detail.value.competitors.map((c) => {
    const overlay = rowState.get(c.id)
    const done = c.ascent !== null
    return {
      id: c.id,
      bib: c.bib,
      firstName: c.firstName,
      lastName: c.lastName,
      categoryLabel: c.categoryLabel,
      done,
      // La donnée (fait/valeurs) vient directement du cache local, déjà mis
      // à jour de façon optimiste dès la saisie (ascent-mutations.ts) — ce
      // qui reste à superposer ici, c'est uniquement l'état de
      // synchronisation de la file.
      syncStatus: overlay ? overlay.status : done ? 'synced' : null,
      canCorrect: done && rowState.canCorrect(c.id, nowMs.value),
      summary: c.ascent ? summarize(c.ascent) : '',
      rejectedReason: overlay?.status === 'rejected' ? overlay.reason : undefined,
      // SPEC.md § 6.3 : « l'affiche au juge avec les deux valeurs » —
      // `incoming` est ce que CE juge a saisi, `existing` la valeur déjà en
      // base d'un autre appareil.
      conflictSummary: overlay?.conflict
        ? {
            yours: summarize(overlay.conflict.incoming),
            other: summarize(overlay.conflict.existing),
          }
        : undefined,
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

    <template v-if="!detail">
      <h1 class="text-xl font-bold text-gray-900">Voie indisponible hors ligne</h1>
      <p class="text-gray-700">
        Cette voie n'a pas encore été téléchargée sur cet appareil — reconnectez-vous une fois en
        ligne pour la récupérer.
      </p>
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
              <p
                v-if="c.syncStatus === 'rejected'"
                role="alert"
                class="text-sm font-medium text-red-700"
              >
                Rejeté par le serveur — {{ c.rejectedReason }}
              </p>
              <div
                v-else-if="c.syncStatus === 'conflict'"
                role="alert"
                class="text-sm text-red-700"
              >
                <p class="font-medium">
                  Conflit : un autre appareil a enregistré une valeur différente pour ce passage —
                  l'organisateur tranchera.
                </p>
                <p v-if="c.conflictSummary">
                  Vous avez saisi : {{ c.conflictSummary.yours }} — un autre appareil a saisi :
                  {{ c.conflictSummary.other }}
                </p>
              </div>
              <SyncStatusIndicator v-else :status="c.syncStatus ?? 'synced'" />
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
