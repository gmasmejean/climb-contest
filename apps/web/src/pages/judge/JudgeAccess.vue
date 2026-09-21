<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '../../api/client'
import { judgeAuthApi } from '../../api/judge-auth'
import { setJudgeSession } from '../../api/judge-session'
import { bootstrapJudge } from '../../judge/bootstrap'
import BrandShell from '../../components/brand/BrandShell.vue'
import { TONE_CLASS, watercolorBackground } from '../../components/brand/watercolor'
import RoleIcon from '../../components/landing/RoleIcon.vue'

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
    try {
      // Déclenché une fois, au moment où le juge a encore du réseau
      // (SPEC.md § 6.3) — plus aucun écran juge n'en dépendra ensuite.
      await bootstrapJudge()
    } catch {
      throw new Error(
        'Connexion réussie, mais impossible de télécharger vos voies — vérifiez votre réseau et réessayez.',
      )
    }
    await router.replace({ name: 'judge-home' })
  } catch (error) {
    authError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : error instanceof Error
          ? error.message
          : 'Une erreur inattendue est survenue.'
    pin.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BrandShell decor>
    <main class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-8">
      <p v-if="access === 'loading'" class="text-center text-gray-600">Chargement…</p>

      <section
        v-else-if="access === 'invalid'"
        class="flex flex-col gap-3 rounded-2xl bg-cover bg-center p-5"
        :class="TONE_CLASS.coral"
        :style="{ backgroundImage: watercolorBackground('coral') }"
      >
        <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">Lien invalide</h1>
        <p class="text-ink text-base">
          Ce lien n'est plus valide — contactez l'organisateur de la compétition pour en obtenir un
          nouveau.
        </p>
      </section>

      <section
        v-else
        class="flex flex-col gap-5 rounded-2xl bg-cover bg-center p-5"
        :class="TONE_CLASS.green"
        :style="{ backgroundImage: watercolorBackground('green') }"
      >
        <header class="flex items-center gap-3">
          <RoleIcon name="judges" class="text-ink size-12 shrink-0" />
          <div class="flex flex-col">
            <p class="text-ink text-sm font-semibold tracking-wide uppercase">Espace juge</p>
            <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
              Bonjour {{ access.displayName }}
            </h1>
          </div>
        </header>

        <form v-if="access.pinRequired" class="flex flex-col gap-4" @submit.prevent="submit">
          <label class="flex flex-col gap-2">
            <span class="text-ink text-base font-semibold">Votre code à 6 chiffres</span>
            <input
              v-model="pin"
              type="tel"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              autofocus
              class="border-navy text-ink focus-visible:outline-navy min-h-16 rounded-2xl border bg-white px-4 text-center text-3xl tracking-[0.5em] focus-visible:outline-2 focus-visible:outline-offset-2"
            />
          </label>
          <p
            v-if="authError"
            role="alert"
            class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            {{ authError }}
          </p>
          <Button type="submit" full-width :disabled="submitting || pin.length !== 6">
            {{ submitting ? 'Vérification…' : 'Valider' }}
          </Button>
        </form>

        <template v-else>
          <p class="text-ink text-base">Prêt à noter les passages sur vos voies.</p>
          <p
            v-if="authError"
            role="alert"
            class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            {{ authError }}
          </p>
          <Button full-width :disabled="submitting" @click="submit">
            {{ submitting ? 'Connexion…' : 'Commencer' }}
          </Button>
        </template>

        <p class="text-ink text-sm">
          Vos voies sont téléchargées sur ce téléphone à la connexion : vous pourrez ensuite noter
          même sans réseau.
        </p>
      </section>
    </main>
  </BrandShell>
</template>
