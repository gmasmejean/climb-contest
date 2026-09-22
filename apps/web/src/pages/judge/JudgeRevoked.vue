<script setup lang="ts">
import { computed, watchEffect } from 'vue'

import { clearJudgeSession, judgeToken } from '../../api/judge-session'
import { judgeDb } from '../../judge/local-db'
import { describeQueueItems } from '../../judge/queue-description'
import { useSyncHydrated, useSyncSnapshot } from '../../judge/sync-runtime'
import { useLiveQuery } from '../../judge/use-live-query'

/**
 * Lot 21 (ADR-078) — l'accès de ce juge a été révoqué. L'écran ne lit QUE le
 * téléphone (CLAUDE.md, conséquence n° 2). Il laisse la file finir de partir —
 * le serveur reçoit encore le lot d'un accès révoqué, pour validation par
 * l'organisateur — puis déconnecte le juge. Rien n'est effacé de l'appareil.
 */
const items = useSyncSnapshot()
const hydrated = useSyncHydrated()
const routeDetails = useLiveQuery(
  async () => (await judgeDb.routeDetails.toArray()).map((row) => row.detail),
  [],
)

const waitingCount = computed(
  () => items.value.filter((item) => item.state === 'pending' || item.state === 'sending').length,
)
const held = computed(() =>
  describeQueueItems(
    items.value.filter((item) => item.state === 'rejected' || item.state === 'conflict'),
    routeDetails.value,
  ),
)
// Une file pas encore relue d'IndexedDB est « vide » sans l'être : on attend.
const sending = computed(() => !hydrated.value || waitingCount.value > 0)

watchEffect(() => {
  // Le jeton sert encore à envoyer la file : on ne le retire qu'une fois vide.
  if (!sending.value && judgeToken.value !== null) clearJudgeSession()
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-4 py-8">
    <h1 class="text-2xl font-bold text-gray-900">Votre accès a été révoqué</h1>
    <p class="text-gray-800">
      L'organisateur a retiré cet accès. Vous ne pouvez plus noter de passage avec ce lien —
      demandez-lui un nouveau lien si vous devez continuer.
    </p>

    <p
      v-if="sending"
      role="status"
      data-testid="judge-revoked-sending"
      class="rounded-lg bg-amber-100 px-4 py-3 font-medium text-amber-900"
    >
      <template v-if="waitingCount > 0">
        Envoi de vos {{ waitingCount }} dernière(s) saisie(s)… Gardez cette page ouverte.
      </template>
      <template v-else>Vérification de vos saisies…</template>
    </p>
    <p
      v-else
      role="status"
      data-testid="judge-revoked-done"
      class="rounded-lg bg-green-100 px-4 py-3 font-medium text-green-900"
    >
      Toutes vos saisies ont été transmises. L'organisateur les validera une par une.
    </p>

    <section v-if="held.length > 0" class="flex flex-col gap-3">
      <h2 class="text-lg font-bold text-gray-900">
        {{ held.length }} saisie(s) à montrer à l'organisateur
      </h2>
      <p class="text-gray-800">
        Elles n'ont pas pu être enregistrées telles quelles. Montrez cet écran à l'organisateur : il
        pourra les ressaisir.
      </p>
      <ul class="flex flex-col gap-2">
        <li
          v-for="entry in held"
          :key="entry.id"
          class="rounded-lg border border-gray-300 bg-white p-3 text-gray-900"
        >
          <p class="font-medium">{{ entry.competitor }}</p>
          <p>{{ entry.route }} — {{ entry.value }}</p>
          <p v-if="entry.reason" class="text-sm text-red-800">{{ entry.reason }}</p>
          <p v-else class="text-sm text-red-800">
            En conflit avec une autre saisie — l'organisateur tranchera.
          </p>
        </li>
      </ul>
    </section>
  </main>
</template>
