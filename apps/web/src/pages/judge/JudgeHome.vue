<script setup lang="ts">
import { Badge, Button, useToast } from '@climbcontest/ui'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { clearJudgeSession, judgeToken } from '../../api/judge-session'
import { bootstrapJudge } from '../../judge/bootstrap'
import { judgeDb } from '../../judge/local-db'
import { useJudgeRoutesList } from '../../judge/local-store'
import { refreshRoutesIfQueueIdle, type RefreshOutcome } from '../../judge/refresh-routes'
import { useLiveQuery } from '../../judge/use-live-query'

const router = useRouter()
const toast = useToast()
const refreshing = ref(false)

const REFRESH_MESSAGES: Record<RefreshOutcome, { text: string; tone: 'success' | 'error' }> = {
  refreshed: { text: 'Vos voies sont à jour.', tone: 'success' },
  'waiting-for-queue': {
    text: 'Des saisies attendent d’être envoyées. Patientez que le bandeau indique « À jour », puis réessayez.',
    tone: 'error',
  },
  failed: {
    text: 'Impossible de joindre le serveur. Vos saisies restent enregistrées sur ce téléphone.',
    tone: 'error',
  },
  'no-session': { text: 'Reconnectez-vous avec votre lien pour actualiser vos voies.', tone: 'error' },
  // ADR-078 : l'écran « accès révoqué » prend le relais aussitôt.
  revoked: { text: 'Votre accès a été révoqué par l’organisateur.', tone: 'error' },
}

// ADR-055 : jamais d'écrasement d'une saisie en attente — le bouton est la
// version manuelle de l'actualisation automatique.
async function refreshRoutes(): Promise<void> {
  refreshing.value = true
  try {
    const outcome = await refreshRoutesIfQueueIdle({
      hasJudgeSession: () => judgeToken.value !== null,
      bootstrap: bootstrapJudge,
    })
    const message = REFRESH_MESSAGES[outcome]
    toast.show(message.text, message.tone)
  } finally {
    refreshing.value = false
  }
}
// Lecture locale seule (ADR-012, SPEC.md § 6.3) — jamais de dépendance
// réseau pour afficher cet écran.
const routes = useJudgeRoutesList()
const neverBootstrapped = useLiveQuery(
  async () => (await judgeDb.meta.get('judge')) === undefined,
  true,
)

function logout(): void {
  clearJudgeSession()
  void router.replace({ name: 'home' })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-4 py-8">
    <template v-if="neverBootstrapped">
      <h1 class="text-xl font-bold text-gray-900">Rien de téléchargé pour l'instant</h1>
      <p class="text-gray-700">
        Reconnectez-vous une fois en ligne pour télécharger vos voies — vous pourrez ensuite noter
        les passages hors ligne toute la journée.
      </p>
      <button
        type="button"
        class="min-h-12 text-left text-sm font-medium text-blue-700 hover:underline"
        @click="logout"
      >
        Effacer cet accès sur cet appareil
      </button>
    </template>

    <template v-else>
      <div class="flex items-center justify-between gap-3">
        <h1 class="text-2xl font-bold text-gray-900">Vos voies</h1>
        <Button variant="secondary" :disabled="refreshing" @click="refreshRoutes">
          Actualiser mes voies
        </Button>
      </div>
      <ul class="flex flex-col gap-3">
        <li v-for="r in routes" :key="r.id">
          <RouterLink
            :to="{ name: 'judge-route', params: { routeId: r.id } }"
            class="flex min-h-16 flex-col gap-1 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <div class="flex items-center justify-between gap-4">
              <span class="font-medium text-gray-900">
                Voie {{ r.number }}<template v-if="r.name"> — {{ r.name }}</template>
              </span>
              <Badge v-if="r.progress" tone="neutral">
                {{ r.progress.done }}/{{ r.progress.expected }}
              </Badge>
              <Badge v-else tone="warning">Aucun tour ouvert</Badge>
            </div>
            <p class="text-sm text-gray-600">
              {{ r.holdCount }} prises<template v-if="r.categories.length">
                — {{ r.categories.map((c) => c.label).join(', ') }}</template
              >
            </p>
          </RouterLink>
        </li>
        <li v-if="routes.length === 0" class="text-gray-600">Aucune voie assignée.</li>
      </ul>
      <button
        type="button"
        class="min-h-12 text-left text-sm font-medium text-blue-700 hover:underline"
        @click="logout"
      >
        Se déconnecter
      </button>
    </template>
  </main>
</template>
