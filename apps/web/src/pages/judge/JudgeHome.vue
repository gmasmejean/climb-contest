<script setup lang="ts">
import type { JudgeRoutesResponse } from '@climbcontest/contracts'
import { Badge } from '@climbcontest/ui'
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { judgeRoutesApi } from '../../api/judge-ascents'
import { clearJudgeSession } from '../../api/judge-session'

const router = useRouter()
const routes = ref<JudgeRoutesResponse | 'loading' | 'error'>('loading')

onMounted(async () => {
  try {
    routes.value = await judgeRoutesApi.list()
  } catch {
    routes.value = 'error'
  }
})

function logout(): void {
  clearJudgeSession()
  void router.replace({ name: 'home' })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-4 py-8">
    <template v-if="routes === 'loading'">
      <p class="text-gray-600">Chargement…</p>
    </template>

    <template v-else-if="routes === 'error'">
      <h1 class="text-xl font-bold text-gray-900">Accès indisponible</h1>
      <p class="text-gray-700">
        Votre accès n'est plus valide — il a peut-être été révoqué. Contactez l'organisateur.
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
      <h1 class="text-2xl font-bold text-gray-900">Vos voies</h1>
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
