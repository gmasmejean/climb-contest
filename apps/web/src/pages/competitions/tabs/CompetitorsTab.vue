<script setup lang="ts">
import { createCompetitorInputSchema } from '@climbcontest/contracts'
import { Button, NumberField, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, competitorsApi } from '../../../api/competitions'
import CompetitorImportWizard from '../CompetitorImportWizard.vue'

const props = defineProps<{ competitionId: string }>()

const queryClient = useQueryClient()
const toast = useToast()
const competitorsKey = ['competitions', props.competitionId, 'competitors']
const categoriesKey = ['competitions', props.competitionId, 'categories']

const { data: competitors, isPending } = useQuery({
  queryKey: competitorsKey,
  queryFn: () => competitorsApi.list(props.competitionId),
})
const { data: categories } = useQuery({
  queryKey: categoriesKey,
  queryFn: () => categoriesApi.list(props.competitionId),
})

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: competitorsKey })
}

const categoryLabel = (categoryId: string) =>
  categories.value?.find((c) => c.id === categoryId)?.label ?? '—'
const categoryOptions = computed(
  () => categories.value?.map((c) => ({ value: c.id, label: c.label })) ?? [],
)

// --- Saisie rapide ---
const form = reactive({
  categoryId: '',
  bib: null as number | null,
  firstName: '',
  lastName: '',
})
const formError = ref('')
// Typé sur la forme exposée par TextField (`defineExpose`) plutôt que sur
// son type d'instance complet — plus robuste pour l'analyse de type d'ESLint
// sur les refs de composant `<script setup>`.
const firstNameInput = ref<{ focus: () => void } | null>(null)

const { mutate: createCompetitor, isPending: isCreating } = useMutation({
  mutationFn: () =>
    competitorsApi.create(props.competitionId, {
      categoryId: form.categoryId,
      bib: form.bib,
      firstName: form.firstName,
      lastName: form.lastName,
    }),
  onSuccess: async () => {
    form.bib = null
    form.firstName = ''
    form.lastName = ''
    await refresh()
    firstNameInput.value?.focus()
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onCreate(): void {
  formError.value = ''
  const result = createCompetitorInputSchema.safeParse({
    categoryId: form.categoryId,
    bib: form.bib,
    firstName: form.firstName,
    lastName: form.lastName,
  })
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  createCompetitor()
}

// --- Assignation automatique des dossards ---
const { mutate: assignBibs, isPending: isAssigning } = useMutation({
  mutationFn: () => competitorsApi.assignBibs(props.competitionId),
  onSuccess: async () => {
    await refresh()
    toast.show('Dossards attribués.', 'success')
  },
})

// --- Recherche / filtre ---
const search = ref('')
const categoryFilter = ref('')
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return (competitors.value ?? []).filter((c) => {
    if (categoryFilter.value && c.categoryId !== categoryFilter.value) return false
    if (!term) return true
    return (
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(term) ||
      String(c.bib ?? '').includes(term)
    )
  })
})

// --- Édition / retrait ---
const editingId = ref<string | null>(null)
const editForm = reactive({ bib: null as number | null, categoryId: '' })
function startEdit(competitor: { id: string; bib: number | null; categoryId: string }): void {
  editingId.value = competitor.id
  editForm.bib = competitor.bib
  editForm.categoryId = competitor.categoryId
}
const { mutate: saveEdit, isPending: isSaving } = useMutation({
  mutationFn: () =>
    competitorsApi.update(props.competitionId, editingId.value ?? '', {
      bib: editForm.bib,
      categoryId: editForm.categoryId,
    }),
  onSuccess: async () => {
    editingId.value = null
    await refresh()
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Modification impossible.',
      'error',
    )
  },
})

const confirmingDeleteId = ref<string | null>(null)
const { mutate: removeCompetitor, isPending: isDeleting } = useMutation({
  mutationFn: (id: string) => competitorsApi.remove(props.competitionId, id),
  onSuccess: async () => {
    confirmingDeleteId.value = null
    await refresh()
    toast.show('Compétiteur retiré.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Retrait impossible.',
      'error',
    )
    confirmingDeleteId.value = null
  },
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
      @submit.prevent="onCreate"
    >
      <h2 class="font-medium text-gray-900">Ajouter un compétiteur</h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TextField ref="firstNameInput" v-model="form.firstName" label="Prénom" required />
        <TextField v-model="form.lastName" label="Nom" required />
        <Select v-model="form.categoryId" label="Catégorie" :options="categoryOptions" required />
        <NumberField v-model="form.bib" label="Dossard (optionnel)" :min="1" />
      </div>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button type="submit" :disabled="isCreating">{{ isCreating ? 'Ajout…' : 'Ajouter' }}</Button>
    </form>

    <Button variant="secondary" :disabled="isAssigning" @click="assignBibs()">
      {{ isAssigning ? 'Attribution…' : 'Assigner les dossards automatiquement' }}
    </Button>

    <CompetitorImportWizard :competition-id="competitionId" @imported="refresh" />

    <div class="grid grid-cols-2 gap-4">
      <TextField v-model="search" label="Rechercher (nom ou dossard)" />
      <Select
        v-model="categoryFilter"
        label="Filtrer par catégorie"
        :options="[{ value: '', label: 'Toutes' }, ...categoryOptions]"
      />
    </div>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="competitor in filtered"
        :key="competitor.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <template v-if="editingId === competitor.id">
          <div class="flex flex-1 flex-wrap items-end gap-3">
            <NumberField v-model="editForm.bib" label="Dossard" :min="1" />
            <Select v-model="editForm.categoryId" label="Catégorie" :options="categoryOptions" />
            <Button :disabled="isSaving" @click="saveEdit()">Enregistrer</Button>
            <Button variant="secondary" @click="editingId = null">Annuler</Button>
          </div>
        </template>
        <template v-else>
          <div>
            <span class="font-medium text-gray-900"
              >{{ competitor.bib ?? '—' }} — {{ competitor.firstName }}
              {{ competitor.lastName }}</span
            >
            <p class="text-sm text-gray-600">{{ categoryLabel(competitor.categoryId) }}</p>
          </div>
          <div class="flex gap-2">
            <template v-if="confirmingDeleteId === competitor.id">
              <Button
                variant="danger"
                :disabled="isDeleting"
                @click="removeCompetitor(competitor.id)"
                >Confirmer</Button
              >
              <Button variant="secondary" @click="confirmingDeleteId = null">Annuler</Button>
            </template>
            <template v-else>
              <Button variant="secondary" @click="startEdit(competitor)">Modifier</Button>
              <Button variant="secondary" @click="confirmingDeleteId = competitor.id"
                >Retirer</Button
              >
            </template>
          </div>
        </template>
      </li>
      <li v-if="filtered.length === 0" class="text-gray-600">Aucun compétiteur.</li>
    </ul>
  </div>
</template>
