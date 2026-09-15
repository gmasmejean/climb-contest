<script setup lang="ts">
import { Button, TextField, useToast } from '@climbcontest/ui'
import { computed, reactive, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ApiError, apiFetch } from '../api/client'
import { setSession } from '../api/session'

const route = useRoute()
const router = useRouter()
const { show } = useToast()

const form = reactive({ email: '', password: '' })
const errors = reactive<{ email?: string; password?: string }>({})
const submitting = ref(false)
const formError = ref('')
const needsVerification = ref(false)
const resending = ref(false)

const banner = computed(() => {
  if (route.query['verified'] === '1') {
    return { text: 'E-mail vérifié — vous pouvez vous connecter.', variant: 'success' as const }
  }
  if (route.query['verify_error'] === '1') {
    return {
      text: 'Ce lien de vérification est invalide ou a expiré.',
      variant: 'error' as const,
    }
  }
  if (route.query['registered'] === '1') {
    return {
      text: 'Compte créé — vérifiez votre boîte mail pour l’activer.',
      variant: 'info' as const,
    }
  }
  return null
})

async function onSubmit(): Promise<void> {
  delete errors.email
  delete errors.password
  formError.value = ''
  needsVerification.value = false

  if (!form.email) errors.email = 'L’e-mail est obligatoire.'
  if (!form.password) errors.password = 'Le mot de passe est obligatoire.'
  if (errors.email || errors.password) return

  submitting.value = true
  try {
    const result = await apiFetch<{ accessToken: string; user: Parameters<typeof setSession>[1] }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify(form) },
    )
    setSession(result.accessToken, result.user)
    await router.push({ name: 'home' })
  } catch (error) {
    if (error instanceof ApiError) {
      formError.value = error.detail ?? error.title
      if (error.title === 'E-mail non vérifié') {
        needsVerification.value = true
      }
    } else {
      formError.value = 'Une erreur inattendue est survenue.'
    }
  } finally {
    submitting.value = false
  }
}

async function onResend(): Promise<void> {
  resending.value = true
  try {
    await apiFetch('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email: form.email }),
    })
    show('E-mail de vérification renvoyé.', 'success')
  } finally {
    resending.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
    <h1 class="text-2xl font-bold text-gray-900">Connexion</h1>

    <p
      v-if="banner"
      role="status"
      class="rounded-lg px-4 py-3 text-sm"
      :class="{
        'bg-green-100 text-green-800': banner.variant === 'success',
        'bg-red-100 text-red-800': banner.variant === 'error',
        'bg-blue-100 text-blue-800': banner.variant === 'info',
      }"
    >
      {{ banner.text }}
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <TextField
        v-model="form.email"
        label="E-mail"
        type="email"
        autocomplete="email"
        required
        :error="errors.email"
      />
      <TextField
        v-model="form.password"
        label="Mot de passe"
        type="password"
        autocomplete="current-password"
        required
        :error="errors.password"
      />

      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button v-if="needsVerification" variant="secondary" :disabled="resending" @click="onResend">
        Renvoyer l’e-mail de vérification
      </Button>

      <Button type="submit" full-width :disabled="submitting">
        {{ submitting ? 'Connexion…' : 'Se connecter' }}
      </Button>
    </form>

    <p class="text-center text-sm text-gray-600">
      Pas encore de compte ?
      <RouterLink to="/register" class="font-medium text-blue-700 hover:underline"
        >Créer un compte</RouterLink
      >
    </p>
  </main>
</template>
