<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { JudgeMe } from '@climbcontest/contracts'

import { judgeAuthApi } from '../../api/judge-auth'
import { clearJudgeSession } from '../../api/judge-session'

const router = useRouter()
const me = ref<JudgeMe | 'loading' | 'error'>('loading')

onMounted(async () => {
  try {
    me.value = await judgeAuthApi.me()
  } catch {
    me.value = 'error'
  }
})

function logout(): void {
  clearJudgeSession()
  void router.replace({ name: 'home' })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-6 px-4 py-8">
    <template v-if="me === 'loading'">
      <p class="text-gray-600">Chargement…</p>
    </template>

    <template v-else-if="me === 'error'">
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
      <h1 class="text-2xl font-bold text-gray-900">Bonjour {{ me.displayName }}</h1>
      <p class="text-gray-600">Vos voies :</p>
      <ul class="flex flex-col gap-2">
        <li v-for="r in me.routes" :key="r.id" class="rounded-lg border border-gray-200 px-4 py-3">
          <span class="font-medium text-gray-900">Voie {{ r.number }}</span>
          <span v-if="r.name"> — {{ r.name }}</span>
          <p class="text-sm text-gray-600">{{ r.holdCount }} prises</p>
        </li>
        <li v-if="me.routes.length === 0" class="text-gray-600">Aucune voie assignée.</li>
      </ul>
      <p class="text-xs text-gray-500">La saisie des passages arrive au prochain lot.</p>
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
