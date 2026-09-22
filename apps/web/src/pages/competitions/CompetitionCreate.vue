<script setup lang="ts">
import { createCompetitionInputSchema, type CreateCompetitionInput } from '@climbcontest/contracts'
import { Button, NumberField, Select, TextField } from '@climbcontest/ui'
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '../../api/client'
import { competitionsApi } from '../../api/competitions'
import { useFormDraft } from '../../composables/useFormDraft'
import BrandShell from '../../components/brand/BrandShell.vue'
import OrganizerMenu from '../../components/brand/OrganizerMenu.vue'

const router = useRouter()

interface FormState {
  name: string
  venue: string
  startsOn: string
  endsOn: string
  format: 'contest' | 'phases'
  routesCounted: number | null
}

const form = reactive<FormState>({
  name: '',
  venue: '',
  startsOn: '',
  endsOn: '',
  format: 'contest',
  routesCounted: 3,
})
type ErrorField = 'name' | 'venue' | 'startsOn' | 'endsOn'
const errorFields: readonly ErrorField[] = ['name', 'venue', 'startsOn', 'endsOn']
const errors = reactive<Partial<Record<ErrorField, string>>>({})

// Une compétition de club tient en général sur une journée : quand on change
// la date de début, la date de fin la suit. Branché sur l'événement (et non
// sur un `watch`) pour ne pas écraser la date de fin d'un brouillon restauré.
// Une saisie partielle du sélecteur de date vaut '' : on n'y touche pas.
function onStartsOnInput(value: string): void {
  if (value !== '') form.endsOn = value
}
const submitting = ref(false)
const formError = ref('')

const { clearDraft } = useFormDraft('competition-create', form)

const formatOptions = [
  { value: 'contest', label: 'Contest — N voies libres, M meilleures comptent' },
  { value: 'phases', label: 'Phases — qualification puis demi-finale / finale' },
]

function buildPayload(): CreateCompetitionInput {
  return {
    name: form.name,
    venue: form.venue,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    format: form.format,
    scoringEngineId: 'ffme-difficulty-2026',
    scoringConfig:
      form.format === 'contest' ? { routesCounted: form.routesCounted ?? 1 } : undefined,
  }
}

function validate(): boolean {
  for (const key of Object.keys(errors) as (keyof typeof errors)[]) delete errors[key]
  const result = createCompetitionInputSchema.safeParse(buildPayload())
  if (result.success) return true
  for (const issue of result.error.issues) {
    // Le refine (date de fin < date de début) est rattaché à `endsOn`
    // (path: ['endsOn']) — les autres champs possibles (format,
    // scoringEngineId…) n'ont pas de champ d'erreur dédié dans ce
    // formulaire (Select/NumberField ne produisent pas de valeur invalide).
    const field = issue.path[0]
    if (typeof field === 'string' && errorFields.includes(field as ErrorField)) {
      errors[field as ErrorField] = issue.message
    }
  }
  return false
}

async function onSubmit(): Promise<void> {
  formError.value = ''
  if (!validate()) return

  submitting.value = true
  try {
    const created = await competitionsApi.create(buildPayload())
    clearDraft()
    await router.push({ name: 'competition-detail', params: { id: created.id } })
  } catch (error) {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BrandShell width="wide">
    <template #actions>
      <OrganizerMenu />
    </template>
    <main class="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-8 lg:px-8">
      <div class="flex max-w-2xl flex-col gap-6">
        <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
          Nouvelle compétition
        </h1>

        <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
          <TextField
            v-model="form.name"
            label="Nom de la compétition"
            required
            :error="errors.name"
          />
          <TextField v-model="form.venue" label="Lieu" required :error="errors.venue" />
          <div class="grid grid-cols-2 gap-4">
            <TextField
              v-model="form.startsOn"
              type="date"
              label="Date de début"
              required
              :error="errors.startsOn"
              @update:model-value="onStartsOnInput"
            />
            <TextField
              v-model="form.endsOn"
              type="date"
              label="Date de fin"
              required
              :error="errors.endsOn"
            />
          </div>
          <Select v-model="form.format" label="Format" :options="formatOptions" required />
          <NumberField
            v-if="form.format === 'contest'"
            v-model="form.routesCounted"
            label="Nombre de voies comptées (M)"
            :min="1"
            hint="Chaque compétiteur grimpe librement ses voies ; les M meilleures sont additionnées."
            required
          />
          <p class="text-sm text-gray-600">Moteur de cotation : FFME — Difficulté 2026.</p>

          <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>

          <Button type="submit" full-width :disabled="submitting">
            {{ submitting ? 'Création…' : 'Créer la compétition' }}
          </Button>
        </form>
      </div>
    </main>
  </BrandShell>
</template>
