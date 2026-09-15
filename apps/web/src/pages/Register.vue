<script setup lang="ts">
import { registerInputSchema } from '@climbcontest/contracts'
import { Button, TextField } from '@climbcontest/ui'
import { reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import { ApiError, apiFetch } from '../api/client'

const router = useRouter()

const form = reactive({ email: '', password: '', displayName: '', clubName: '' })
const errors = reactive<Partial<Record<keyof typeof form, string>>>({})
const submitting = ref(false)
const formError = ref('')

function validate(): boolean {
  for (const key of Object.keys(errors) as (keyof typeof form)[]) {
    delete errors[key]
  }
  const result = registerInputSchema.safeParse(form)
  if (result.success) return true
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && field in form) {
      errors[field as keyof typeof form] = issue.message
    }
  }
  return false
}

async function onSubmit(): Promise<void> {
  formError.value = ''
  if (!validate()) return

  submitting.value = true
  try {
    await apiFetch('/auth/register', { method: 'POST', body: JSON.stringify(form) })
    await router.push({ name: 'login', query: { registered: '1' } })
  } catch (error) {
    formError.value =
      error instanceof ApiError ? error.detail ?? error.title : 'Une erreur inattendue est survenue.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
    <h1 class="text-2xl font-bold text-gray-900">Créer un compte organisateur</h1>

    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <TextField v-model="form.clubName" label="Nom du club" required :error="errors.clubName" />
      <TextField
        v-model="form.displayName"
        label="Votre nom"
        required
        :error="errors.displayName"
      />
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
        autocomplete="new-password"
        hint="Au moins 12 caractères."
        required
        :error="errors.password"
      />

      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>

      <Button type="submit" full-width :disabled="submitting">
        {{ submitting ? 'Création…' : 'Créer mon compte' }}
      </Button>
    </form>

    <p class="text-center text-sm text-gray-600">
      Déjà organisateur ?
      <RouterLink to="/login" class="font-medium text-blue-700 hover:underline"
        >Se connecter</RouterLink
      >
    </p>
  </main>
</template>
