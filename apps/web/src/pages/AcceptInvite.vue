<script setup lang="ts">
import { acceptInviteInputSchema, type AuthResponse } from '@climbcontest/contracts'
import { Button, TextField, useToast } from '@climbcontest/ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError, apiFetch } from '../api/client'
import { setSession } from '../api/session'
import { describeError } from '../lib/network-errors'
import BrandShell from '../components/brand/BrandShell.vue'

/**
 * Acceptation d'une invitation (Lot 24, ADR-087). Le lien de l'e-mail mène ici ;
 * rien n'est consommé au chargement (ADR-020) : le jeton n'est envoyé qu'avec le
 * mot de passe choisi. Il est retiré de l'adresse aussitôt lu, pour ne pas
 * rester dans l'historique ni dans une capture d'écran.
 */

const route = useRoute()
const router = useRouter()
const { show } = useToast()

// Lu dès la création (pas au montage) : sinon « lien incomplet » s'afficherait
// une fraction de seconde avant le formulaire.
const fromUrl = route.query['token']
const token = ref<string | null>(typeof fromUrl === 'string' && fromUrl !== '' ? fromUrl : null)
const password = ref('')
const passwordError = ref('')
const formError = ref('')
const submitting = ref(false)

onMounted(async () => {
  if (token.value) await router.replace({ query: { ...route.query, token: undefined } })
})

async function onSubmit(): Promise<void> {
  passwordError.value = ''
  formError.value = ''
  if (!token.value) return
  const parsed = acceptInviteInputSchema.safeParse({ token: token.value, password: password.value })
  if (!parsed.success) {
    passwordError.value = 'Le mot de passe doit contenir au moins 12 caractères.'
    return
  }
  submitting.value = true
  try {
    const result = await apiFetch<AuthResponse>('/auth/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    })
    setSession(result.accessToken, result.user)
    show(`Bienvenue, ${result.user.displayName} — votre compte est activé.`, 'success')
    await router.push({ name: 'competition-list' })
  } catch (error) {
    formError.value =
      error instanceof ApiError && error.status === 400
        ? `${describeError(error)} Demandez à la personne qui vous a invité de vous renvoyer une invitation.`
        : describeError(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BrandShell decor>
    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-8">
      <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
        Rejoindre l’organisation
      </h1>

      <template v-if="token">
        <p class="text-gray-700">
          Choisissez votre mot de passe pour activer votre compte organisateur. Vous l’utiliserez
          ensuite avec votre adresse e-mail pour vous connecter.
        </p>
        <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
          <TextField
            v-model="password"
            label="Mot de passe"
            type="password"
            autocomplete="new-password"
            hint="Au moins 12 caractères."
            required
            :error="passwordError || undefined"
          />
          <p v-if="formError" role="alert" class="text-red-700">{{ formError }}</p>
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Activation…' : 'Activer mon compte' }}
          </Button>
        </form>
      </template>

      <p v-else role="alert" class="text-red-700">
        Ce lien d’invitation est incomplet. Ouvrez de nouveau le lien reçu par e-mail, ou demandez à
        la personne qui vous a invité de vous renvoyer une invitation.
      </p>
    </main>
  </BrandShell>
</template>
