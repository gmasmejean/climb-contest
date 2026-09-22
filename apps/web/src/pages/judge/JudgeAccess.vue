<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '../../api/client'
import { judgeAuthApi } from '../../api/judge-auth'
import { setJudgeSession } from '../../api/judge-session'
import { clearJudgeAccessRevoked } from '../../judge/access-state'
import { bootstrapJudge } from '../../judge/bootstrap'
import { existsOnlyOnDevice, judgeDb } from '../../judge/local-db'
import { describeQueueItems } from '../../judge/queue-description'
import { preloadJudgeScreens } from '../../judge/screens'
import { syncEngine, useSyncHydrated, useSyncSnapshot } from '../../judge/sync-runtime'
import { useLiveQuery } from '../../judge/use-live-query'
import BrandShell from '../../components/brand/BrandShell.vue'
import { TONE_CLASS, watercolorBackground } from '../../components/brand/watercolor'
import RoleIcon from '../../components/landing/RoleIcon.vue'

const route = useRoute()
const router = useRouter()
const token = String(route.params.token ?? '')

// null = chargement ; 'invalid' = lien mort ; sinon les infos d'accueil.
const access = ref<
  'loading' | 'invalid' | { judgeId: string; displayName: string; pinRequired: boolean }
>('loading')
const pin = ref('')
const submitting = ref(false)
const authError = ref('')

// ADR-079 — ce téléphone connaît peut-être déjà UN AUTRE juge, dont la file
// n'est pas vide. Tout se lit en local ; rien n'est effacé sans le dire.
const localJudge = useLiveQuery(async () => (await judgeDb.meta.get('judge')) ?? null, null)
const queueItems = useSyncSnapshot()
const queueHydrated = useSyncHydrated()
const routeDetails = useLiveQuery(
  async () => (await judgeDb.routeDetails.toArray()).map((row) => row.detail),
  [],
)
const switchConfirmed = ref(false)
const discardAsked = ref(false)
const discarding = ref(false)

const otherJudgeName = computed(() => {
  if (typeof access.value === 'string' || localJudge.value === null) return null
  // Même juge (il rescanne son propre QR) : aucun message.
  return localJudge.value.judgeId === access.value.judgeId ? null : localJudge.value.displayName
})
const unsent = computed(() => queueItems.value.filter(existsOnlyOnDevice))
const unsentDescriptions = computed(() => describeQueueItems(unsent.value, routeDetails.value))
const stillSendingCount = computed(
  () => unsent.value.filter((item) => item.state !== 'rejected').length,
)

const step = computed<'sign-in' | 'unsent' | 'confirm-switch'>(() => {
  if (otherJudgeName.value === null || switchConfirmed.value) return 'sign-in'
  // Une file pas encore relue d'IndexedDB est « vide » sans l'être.
  if (!queueHydrated.value || unsent.value.length > 0) return 'unsent'
  return 'confirm-switch'
})

function retrySending(): void {
  // L'ancien jeton est toujours en place : le nouveau n'est posé qu'après.
  syncEngine.onOnline()
}

async function discardUnsent(): Promise<void> {
  discarding.value = true
  try {
    await judgeDb.queue.bulkDelete(unsent.value.map((item) => item.id))
    await syncEngine.hydrate()
    discardAsked.value = false
  } finally {
    discarding.value = false
  }
}

function stayAsLocalJudge(): void {
  void router.replace({ name: 'judge-home' })
}

onMounted(async () => {
  try {
    access.value = await judgeAuthApi.access(token)
  } catch {
    access.value = 'invalid'
  }
})

// Dès qu'on sait qu'un autre juge occupe ce téléphone, on pousse sa file.
watch(otherJudgeName, (name) => {
  if (name !== null) retrySending()
})

async function submit(): Promise<void> {
  authError.value = ''
  submitting.value = true
  try {
    const session = await judgeAuthApi.auth({ token, pin: pin.value || undefined })
    setJudgeSession(session.token)
    clearJudgeAccessRevoked()
    try {
      // Déclenché une fois, au moment où le juge a encore du réseau
      // (SPEC.md § 6.3) — plus aucun écran juge n'en dépendra ensuite.
      // Les écrans eux-mêmes aussi : le précache du service worker peut ne
      // pas être terminé à cet instant (voir `judge/screens.ts`).
      await Promise.all([bootstrapJudge(), preloadJudgeScreens()])
      // La base locale a pu être vidée (autre juge) : la file en mémoire suit.
      await syncEngine.hydrate()
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
        <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
          Lien invalide
        </h1>
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

        <!-- ADR-079 : un autre juge est connu sur ce téléphone, avec des saisies
             qui n'existent que sur ce téléphone. -->
        <div v-if="step === 'unsent'" data-testid="judge-access-unsent" class="flex flex-col gap-4">
          <p v-if="!queueHydrated" class="text-ink text-base">Vérification de ce téléphone…</p>
          <template v-else>
            <p class="text-ink text-base font-semibold">
              Ce téléphone a encore {{ unsent.length }} saisie(s) de {{ otherJudgeName }} qui ne
              sont pas arrivées à l'organisateur.
            </p>
            <p v-if="stillSendingCount > 0" role="status" class="text-ink text-base">
              Envoi en cours… Gardez cette page ouverte, avec du réseau.
            </p>
            <p v-else class="text-ink text-base">
              Elles ont été refusées et ne partiront plus toutes seules. Montrez cet écran à
              l'organisateur pour qu'il les ressaisisse.
            </p>
            <ul class="flex flex-col gap-2">
              <li
                v-for="entry in unsentDescriptions"
                :key="entry.id"
                class="text-ink rounded-lg bg-white p-3"
              >
                <p class="font-medium">{{ entry.competitor }}</p>
                <p>{{ entry.route }} — {{ entry.value }}</p>
                <p v-if="entry.reason" class="text-sm text-red-800">{{ entry.reason }}</p>
              </li>
            </ul>
            <Button v-if="stillSendingCount > 0" full-width @click="retrySending">
              Réessayer l'envoi
            </Button>
            <Button variant="secondary" full-width @click="stayAsLocalJudge">
              Rester {{ otherJudgeName }}
            </Button>
            <template v-if="discardAsked">
              <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                Ces {{ unsent.length }} saisie(s) seront définitivement perdues. Ne continuez que si
                l'organisateur les a déjà ressaisies.
              </p>
              <Button variant="danger" full-width :disabled="discarding" @click="discardUnsent">
                Oui, effacer ces {{ unsent.length }} saisie(s)
              </Button>
              <Button variant="secondary" full-width @click="discardAsked = false">Annuler</Button>
            </template>
            <button
              v-else
              type="button"
              class="text-ink min-h-12 text-left text-sm font-medium underline"
              @click="discardAsked = true"
            >
              L'envoi est impossible ? Effacer ces saisies…
            </button>
          </template>
        </div>

        <div
          v-else-if="step === 'confirm-switch'"
          data-testid="judge-access-confirm-switch"
          class="flex flex-col gap-4"
        >
          <p class="text-ink text-base">
            Ce téléphone est connecté en tant que <strong>{{ otherJudgeName }}</strong
            >. Toutes ses saisies sont bien arrivées.
          </p>
          <Button full-width @click="switchConfirmed = true">
            Continuer en tant que {{ access.displayName }}
          </Button>
          <Button variant="secondary" full-width @click="stayAsLocalJudge">
            Rester {{ otherJudgeName }}
          </Button>
        </div>

        <form
          v-else-if="access.pinRequired"
          class="flex flex-col gap-4"
          @submit.prevent="submit"
        >
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
