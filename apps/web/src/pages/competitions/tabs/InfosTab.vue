<script setup lang="ts">
import { updateCompetitionInputSchema, type Competition } from '@climbcontest/contracts'
import { Badge, Button, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { competitionsApi } from '../../../api/competitions'
import { useFormDraft } from '../../../composables/useFormDraft'

const props = defineProps<{ competition: Competition }>()

const queryClient = useQueryClient()
const toast = useToast()

const form = reactive({
  name: props.competition.name,
  venue: props.competition.venue,
  startsOn: props.competition.startsOn,
  endsOn: props.competition.endsOn,
})
const errors = reactive<Partial<Record<keyof typeof form, string>>>({})
const formError = ref('')

const { clearDraft } = useFormDraft(`competition-edit-${props.competition.id}`, form)

const updateMutation = useMutation({
  mutationFn: () => competitionsApi.update(props.competition.id, { ...form }),
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
  const result = updateCompetitionInputSchema.safeParse(form)
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
})
function applyStatus(): void {
  statusMutation.mutate(pendingStatus.value as Competition['status'])
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <TextField v-model="form.name" label="Nom de la compétition" required :error="errors.name" />
      <TextField v-model="form.venue" label="Lieu" required :error="errors.venue" />
      <div class="grid grid-cols-2 gap-4">
        <TextField
          v-model="form.startsOn"
          type="date"
          label="Date de début"
          required
          :error="errors.startsOn"
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
      <dt class="text-gray-600">URL publique</dt>
      <dd class="text-gray-900">/c/{{ competition.publicSlug }}</dd>
    </dl>
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
