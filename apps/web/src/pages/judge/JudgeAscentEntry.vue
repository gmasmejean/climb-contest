<script setup lang="ts">
import { Button, NumberField, NumericKeypad, useToast } from '@climbcontest/ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { uuidv7 } from 'uuidv7'

import { useWakeLock } from '../../composables/useWakeLock'
import { getDeviceId } from '../../judge/device-id'
import { vibrateOnConfirm } from '../../judge/haptics'
import { useJudgeRouteDetail } from '../../judge/local-store'
import { useAscentRowState } from '../../judge/useAscentRowState'

useWakeLock()

const route = useRoute()
const router = useRouter()
const routeId = String(route.params.routeId ?? '')
const competitorId = String(route.params.competitorId ?? '')
const rowState = useAscentRowState()
const toast = useToast()

type Mode = 'create' | 'correct' | 'readonly'

// Lecture locale seule (ADR-012, SPEC.md § 6.3) — jamais de dépendance
// réseau pour afficher cet écran.
const detail = useJudgeRouteDetail(routeId)
const step = ref<'entry' | 'recap'>('entry')
const nowMs = ref(Date.now())

const holdNumber = ref<number | null>(null)
const modifier = ref<'none' | 'plus'>('none')
const isTop = ref(false)
const status = ref<'valid' | 'dns' | 'dnf'>('valid')
const climbTimeMs = ref<number | null>(null)
const entryError = ref('')
const originalRecordedAt = ref('')
const supersedesId = ref('')

const competitor = computed(
  () => detail.value?.competitors.find((c) => c.id === competitorId) ?? null,
)

// La fenêtre de correction (ADR-007) est désormais dérivée de la dernière
// saisie DURABLE de ce juge (`lastSubmission`, IndexedDB) — plus d'appel
// réseau (`GET /judge/ascents/last`) pour la connaître.
const mode = computed<Mode>(() => {
  if (!competitor.value || competitor.value.ascent === null) return 'create'
  return rowState.canCorrect(competitorId, nowMs.value) ? 'correct' : 'readonly'
})
const correctableUntilMs = computed(() => {
  if (mode.value !== 'correct' || !originalRecordedAt.value) return null
  return new Date(originalRecordedAt.value).getTime() + 5 * 60 * 1000
})
const stillCorrectable = computed(
  () => correctableUntilMs.value !== null && nowMs.value < correctableUntilMs.value,
)

// Préremplissage des champs — UNE SEULE FOIS quand le compétiteur devient
// disponible, jamais à chaque mise à jour réactive du cache local (qui
// écraserait sinon une saisie du juge déjà en cours à l'écran).
let prefilled = false
watch(
  competitor,
  (found) => {
    if (prefilled || !found) return
    prefilled = true
    if (found.ascent !== null && mode.value === 'correct') {
      holdNumber.value = found.ascent.holdNumber
      modifier.value = found.ascent.modifier
      isTop.value = found.ascent.isTop
      status.value = found.ascent.status === 'dsq' ? 'valid' : found.ascent.status
      climbTimeMs.value = found.ascent.climbTimeMs
      originalRecordedAt.value = found.ascent.recordedAt
      supersedesId.value = found.ascent.id
    }
  },
  { immediate: true },
)

let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  ticker = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})

function pickChute(): void {
  status.value = 'valid'
  isTop.value = false
}

function pickTop(): void {
  status.value = 'valid'
  isTop.value = true
  holdNumber.value = null
}

function pickStatus(next: 'dns' | 'dnf'): void {
  status.value = next
  isTop.value = false
  holdNumber.value = null
  climbTimeMs.value = null
}

const keypadDisabled = computed(() => isTop.value || status.value !== 'valid')

function summary(): string {
  if (status.value === 'dns') return 'DNS'
  if (status.value === 'dnf') return 'DNF'
  if (isTop.value) return 'TOP'
  return `prise ${holdNumber.value}${modifier.value === 'plus' ? '+' : ''}`
}

function goToRecap(): void {
  entryError.value = ''
  if (status.value === 'valid' && !isTop.value && holdNumber.value === null) {
    entryError.value = 'Indiquez la prise atteinte, ou choisissez TOP / DNS / DNF.'
    return
  }
  step.value = 'recap'
}

const submitting = ref(false)

async function confirm(): Promise<void> {
  if (!competitor.value || !detail.value?.round) return
  submitting.value = true
  vibrateOnConfirm()

  // Capturé UNE FOIS : l'écriture optimiste (dans `submitCreate`/`submitCorrect`
  // ci-dessous) fait basculer `mode` de façon réactive dès qu'elle atteint
  // Dexie (le compétiteur passe `ascent === null` → non-null, la fenêtre de
  // correction s'ouvre) — le relire après l'await dirait toujours « correct ».
  const submittedMode = mode.value

  if (submittedMode === 'create') {
    const input = {
      id: uuidv7(),
      roundId: detail.value.round.id,
      routeId,
      competitorId,
      holdNumber: holdNumber.value,
      modifier: modifier.value,
      isTop: isTop.value,
      status: status.value,
      climbTimeMs: climbTimeMs.value,
      recordedAt: new Date().toISOString(),
      deviceId: getDeviceId(),
    }
    await rowState.submitCreate(competitorId, input)
  } else if (submittedMode === 'correct') {
    const input = {
      id: uuidv7(),
      holdNumber: holdNumber.value,
      modifier: modifier.value,
      isTop: isTop.value,
      status: status.value,
      climbTimeMs: climbTimeMs.value,
    }
    await rowState.submitCorrect(
      competitorId,
      routeId,
      supersedesId.value,
      input,
      originalRecordedAt.value,
    )
  }

  // Durée réduite (2 s, au lieu des 5 s par défaut) : le toast est rendu au
  // niveau de l'app (App.vue) donc reste affiché par-dessus l'écran SUIVANT
  // après la navigation — sur un écran de 360 px, une confirmation trop
  // longue recouvre le bas du prochain écran pendant que le juge enchaîne
  // déjà sur le compétiteur suivant (CLAUDE.md § accessibilité).
  toast.show(
    submittedMode === 'correct' ? 'Correction enregistrée ✓' : 'Passage enregistré ✓',
    'success',
    2000,
  )
  await router.replace({ name: 'judge-route', params: { routeId } })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col gap-4 px-4 py-8">
    <RouterLink
      :to="{ name: 'judge-route', params: { routeId } }"
      class="text-sm font-medium text-blue-700 hover:underline"
    >
      ← Retour à la voie
    </RouterLink>

    <template v-if="!detail">
      <h1 class="text-xl font-bold text-gray-900">Voie indisponible hors ligne</h1>
      <p class="text-gray-700">
        Cette voie n'a pas encore été téléchargée sur cet appareil — reconnectez-vous une fois en
        ligne pour la récupérer.
      </p>
    </template>

    <template v-else-if="!competitor || !detail.round">
      <h1 class="text-xl font-bold text-gray-900">Passage indisponible</h1>
      <p class="text-gray-700">Impossible de trouver ce compétiteur sur cette voie.</p>
    </template>

    <template v-else-if="mode === 'readonly'">
      <h1 class="text-xl font-bold text-gray-900">Trop tard pour corriger</h1>
      <p class="text-gray-700">
        Ce passage a déjà été confirmé et sa fenêtre de correction est passée — seul l'organisateur
        peut le corriger désormais.
      </p>
    </template>

    <template v-else-if="mode === 'correct' && !stillCorrectable">
      <h1 class="text-xl font-bold text-gray-900">Trop tard pour corriger</h1>
      <p class="text-gray-700">
        La fenêtre de correction vient de se terminer — contactez l'organisateur si besoin.
      </p>
    </template>

    <template v-else>
      <header class="flex flex-col gap-1">
        <h1 class="text-xl font-bold text-gray-900">
          Dossard {{ competitor.bib ?? '—' }} — {{ competitor.firstName }} {{ competitor.lastName }}
        </h1>
        <p class="text-gray-600">{{ competitor.categoryLabel }} — Voie {{ detail.route.number }}</p>
      </header>

      <template v-if="step === 'entry'">
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium text-gray-900">Numéro de prise</span>
          <NumericKeypad
            v-model="holdNumber"
            :min="1"
            :max="detail.route.holdCount"
            :disabled="keypadDisabled"
          />
        </div>

        <div class="flex gap-2">
          <Button
            :variant="modifier === 'none' ? 'primary' : 'secondary'"
            :disabled="keypadDisabled"
            full-width
            @click="modifier = 'none'"
          >
            Neutre
          </Button>
          <Button
            :variant="modifier === 'plus' ? 'primary' : 'secondary'"
            :disabled="keypadDisabled"
            full-width
            @click="modifier = 'plus'"
          >
            +
          </Button>
        </div>

        <button
          type="button"
          class="min-h-16 w-full rounded-xl text-xl font-bold text-white"
          :class="isTop ? 'bg-green-700' : 'bg-green-600 hover:bg-green-700'"
          @click="pickTop"
        >
          TOP
        </button>

        <div class="flex gap-2">
          <Button
            :variant="status === 'valid' && !isTop ? 'primary' : 'secondary'"
            full-width
            @click="pickChute"
          >
            Chute
          </Button>
          <Button
            :variant="status === 'dns' ? 'primary' : 'secondary'"
            full-width
            @click="pickStatus('dns')"
          >
            DNS
          </Button>
          <Button
            :variant="status === 'dnf' ? 'primary' : 'secondary'"
            full-width
            @click="pickStatus('dnf')"
          >
            DNF
          </Button>
        </div>

        <NumberField
          v-if="detail.timingEnabled && status === 'valid'"
          v-model="climbTimeMs"
          label="Temps (ms)"
          :min="0"
        />

        <p v-if="mode === 'correct'" class="text-sm text-gray-600">
          Correction — encore
          {{ Math.max(0, Math.ceil(((correctableUntilMs ?? 0) - nowMs) / 1000)) }} s pour valider.
        </p>

        <p v-if="entryError" role="alert" class="text-sm text-red-700">{{ entryError }}</p>

        <Button full-width @click="goToRecap">Voir le récapitulatif</Button>
      </template>

      <template v-else>
        <p class="rounded-lg border border-gray-200 px-4 py-4 text-lg text-gray-900">
          Dossard {{ competitor.bib ?? '—' }} — {{ competitor.firstName }}
          {{ competitor.lastName }} — Voie {{ detail.route.number }} — {{ summary() }}
        </p>
        <Button full-width :disabled="submitting" @click="confirm">
          {{ submitting ? 'Enregistrement…' : 'Confirmer' }}
        </Button>
        <Button variant="secondary" full-width :disabled="submitting" @click="step = 'entry'">
          Modifier
        </Button>
      </template>
    </template>
  </main>
</template>
