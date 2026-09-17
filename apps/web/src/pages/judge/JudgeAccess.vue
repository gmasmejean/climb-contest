<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '../../api/client'
import { judgeAuthApi } from '../../api/judge-auth'
import { setJudgeSession } from '../../api/judge-session'

const route = useRoute()
const router = useRouter()
const token = String(route.params.token ?? '')

// null = chargement ; 'invalid' = lien mort ; sinon les infos d'accueil.
const access = ref<'loading' | 'invalid' | { displayName: string; pinRequired: boolean }>('loading')
const pin = ref('')
const submitting = ref(false)
const authError = ref('')

onMounted(async () => {
  try {
    access.value = await judgeAuthApi.access(token)
  } catch {
    access.value = 'invalid'
  }
})

async function submit(): Promise<void> {
  authError.value = ''
  submitting.value = true
  try {
    const session = await judgeAuthApi.auth({ token, pin: pin.value || undefined })
    setJudgeSession(session.token)
    await router.replace({ name: 'judge-home' })
  } catch (error) {
    authError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
    pin.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
    <template v-if="access === 'loading'">
      <p class="text-center text-gray-600">Chargement…</p>
    </template>

    <template v-else-if="access === 'invalid'">
      <h1 class="text-xl font-bold text-gray-900">Lien invalide</h1>
      <p class="text-gray-700">
        Ce lien n'est plus valide — contactez l'organisateur de la compétition pour en obtenir un
        nouveau.
      </p>
    </template>

    <template v-else>
      <h1 class="text-2xl font-bold text-gray-900">Bonjour {{ access.displayName }}</h1>

      <form v-if="access.pinRequired" class="flex flex-col gap-4" @submit.prevent="submit">
        <label class="flex flex-col gap-2">
          <span class="text-sm font-medium text-gray-900">Votre code à 6 chiffres</span>
          <input
            v-model="pin"
            type="tel"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="6"
            autofocus
            class="min-h-16 rounded-xl border border-gray-400 px-4 text-center text-3xl tracking-[0.5em]"
          />
        </label>
        <p v-if="authError" role="alert" class="text-sm text-red-700">{{ authError }}</p>
        <Button type="submit" full-width :disabled="submitting || pin.length !== 6">
          {{ submitting ? 'Vérification…' : 'Valider' }}
        </Button>
      </form>

      <template v-else>
        <p class="text-gray-700">Prêt à noter les passages sur vos voies.</p>
        <p v-if="authError" role="alert" class="text-sm text-red-700">{{ authError }}</p>
        <Button full-width :disabled="submitting" @click="submit">
          {{ submitting ? 'Connexion…' : 'Commencer' }}
        </Button>
      </template>
    </template>
  </main>
</template>
