<script setup lang="ts">
import {
  updateCompetitionInputSchema,
  type Address,
  type Competition,
} from '@climbcontest/contracts'
import { Badge, Button, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref, watch } from 'vue'

import { ApiError } from '../../../api/client'
import { competitionsApi } from '../../../api/competitions'
import { organizationApi } from '../../../api/organization'
import { currentUser } from '../../../api/session'
import CompetitionPlaceFields from '../../../components/CompetitionPlaceFields.vue'
import { useFormDraft } from '../../../composables/useFormDraft'
import {
  competitionAddress,
  initialPlaceChoice,
  type PlaceChoice,
} from '../../../lib/competition-place'

const props = defineProps<{ competition: Competition }>()

const queryClient = useQueryClient()
const toast = useToast()

const publicUrl = `${window.location.origin}/c/${props.competition.publicSlug}`

async function copyPublicUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(publicUrl)
    toast.show('Copié.', 'success')
  } catch {
    toast.show('Copie impossible — sélectionnez le texte manuellement.', 'error')
  }
}

const form = reactive<{
  name: string
  venue: string
  // ADR-089 : null tant que la fiche de l'organisation n'est pas arrivée.
  placeChoice: PlaceChoice | null
  address: Address | null
  startsOn: string
  endsOn: string
}>({
  name: props.competition.name,
  venue: props.competition.venue,
  placeChoice: null,
  address: competitionAddress(props.competition),
  startsOn: props.competition.startsOn,
  endsOn: props.competition.endsOn,
})
const errors = reactive<Partial<Record<keyof typeof form, string>>>({})

const { data: organization } = useQuery({
  queryKey: ['organization', 'profile'],
  queryFn: organizationApi.profile,
})
const isOwner = computed(() => currentUser.value?.role === 'owner')
// Affiché « Lieu de l'organisation » seulement si le lieu est exactement celui
// de la fiche ; un brouillon restauré garde son choix.
watch(
  organization,
  (profile) => {
    if (!profile || form.placeChoice !== null) return
    form.placeChoice = initialPlaceChoice(profile, { venue: form.venue, address: form.address })
  },
  { immediate: true },
)

function payload() {
  return {
    name: form.name,
    venue: form.venue,
    address: form.address,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
  }
}

// Une compétition de club tient en général sur une journée : quand on change
// la date de début, la date de fin la suit. Branché sur l'événement (et non
// sur un `watch`) pour ne pas écraser la date de fin d'un brouillon restauré.
// Une saisie partielle du sélecteur de date vaut '' : on n'y touche pas.
function onStartsOnInput(value: string): void {
  if (value !== '') form.endsOn = value
}
const formError = ref('')

const { clearDraft } = useFormDraft(`competition-edit-${props.competition.id}`, form)

const updateMutation = useMutation({
  mutationFn: () => competitionsApi.update(props.competition.id, payload()),
  onSuccess: async (updated) => {
    clearDraft()
    queryClient.setQueryData(['competitions', props.competition.id], updated)
    await queryClient.invalidateQueries({ queryKey: ['competitions'] })
    toast.show('Compétition mise à jour.', 'success')
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onSubmit(): void {
  formError.value = ''
  for (const key of Object.keys(errors) as (keyof typeof errors)[]) delete errors[key]
  const result = updateCompetitionInputSchema.safeParse(payload())
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0]
      if (typeof field === 'string' && field in form)
        errors[field as keyof typeof form] = issue.message
    }
    return
  }
  updateMutation.mutate()
}

const statusOptions = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'open', label: 'Ouverte' },
  { value: 'running', label: 'En cours' },
  { value: 'closed', label: 'Clôturée' },
  { value: 'archived', label: 'Archivée' },
]
// `Select` reste un composant générique en `string` (packages/ui) — la
// conversion vers l'union littérale du domaine se fait au seul point
// d'entrée de l'API, pas dans le typage du champ lui-même.
const pendingStatus = ref<string>(props.competition.status)
const statusMutation = useMutation({
  mutationFn: (status: Competition['status']) =>
    competitionsApi.changeStatus(props.competition.id, { status }),
  onSuccess: async (updated) => {
    queryClient.setQueryData(['competitions', props.competition.id], updated)
    await queryClient.invalidateQueries({ queryKey: ['competitions'] })
    toast.show('Statut mis à jour.', 'success')
  },
  // Le serveur refuse de quitter « En cours » tant qu'une catégorie est ouverte
  // (ADR-065) : son message dit quoi faire, on le montre tel quel.
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Changement de statut impossible.',
      'error',
    )
  },
})
function applyStatus(): void {
  statusMutation.mutate(pendingStatus.value as Competition['status'])
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <TextField v-model="form.name" label="Nom de la compétition" required :error="errors.name" />
      <CompetitionPlaceFields
        v-model:venue="form.venue"
        v-model:address="form.address"
        v-model:choice="form.placeChoice"
        :organization="organization"
        :is-owner="isOwner"
        :errors="{ venue: errors.venue, address: errors.address }"
      />
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
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button type="submit" :disabled="updateMutation.isPending.value">
        {{ updateMutation.isPending.value ? 'Enregistrement…' : 'Enregistrer' }}
      </Button>
    </form>

    <dl class="grid grid-cols-2 gap-2 text-sm">
      <dt class="text-gray-600">Format</dt>
      <dd class="text-gray-900">{{ competition.format === 'contest' ? 'Contest' : 'Phases' }}</dd>
      <dt class="text-gray-600">Moteur de cotation</dt>
      <dd class="text-gray-900">{{ competition.scoringEngineId }}</dd>
    </dl>
    <div class="flex flex-col gap-1">
      <span class="text-sm text-gray-600">URL publique</span>
      <div class="flex flex-wrap items-center gap-2">
        <a
          :href="publicUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="min-h-12 flex-1 break-all rounded-lg border border-gray-300 bg-gray-50 px-3 py-3 text-sm text-blue-700 underline"
        >
          {{ publicUrl }}
        </a>
        <Button variant="secondary" @click="copyPublicUrl">Copier</Button>
      </div>
    </div>
    <p class="text-xs text-gray-500">
      Le format et le moteur de cotation ne peuvent plus être modifiés après la création.
    </p>

    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-900">Statut :</span>
        <Badge>{{ statusOptions.find((o) => o.value === competition.status)?.label }}</Badge>
      </div>
      <div class="flex items-end gap-3">
        <Select v-model="pendingStatus" label="Changer le statut" :options="statusOptions" />
        <Button
          variant="secondary"
          :disabled="statusMutation.isPending.value || pendingStatus === competition.status"
          @click="applyStatus"
        >
          Appliquer
        </Button>
      </div>
    </div>
  </div>
</template>
