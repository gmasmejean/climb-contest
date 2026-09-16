<script setup lang="ts">
import { createCategoryInputSchema } from '@climbcontest/contracts'
import { Badge, Button, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi } from '../../../api/competitions'

const props = defineProps<{ competitionId: string }>()

const queryClient = useQueryClient()
const toast = useToast()
const queryKey = ['competitions', props.competitionId, 'categories']

const { data: categories, isPending } = useQuery({
  queryKey,
  queryFn: () => categoriesApi.list(props.competitionId),
})

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey })
}

const { mutate: applyTemplate, isPending: isApplyingTemplate } = useMutation({
  mutationFn: () => categoriesApi.applyTemplate(props.competitionId),
  onSuccess: async (created) => {
    await refresh()
    toast.show(
      created.length > 0
        ? `${created.length} catégorie(s) créée(s) depuis le modèle FFME.`
        : 'Le modèle FFME est déjà entièrement appliqué.',
      'success',
    )
  },
})

const form = reactive<{ label: string; sex: 'M' | 'F' | 'X' }>({ label: '', sex: 'X' })
const formError = ref('')
const sexOptions = [
  { value: 'F', label: 'Femme' },
  { value: 'M', label: 'Homme' },
  { value: 'X', label: 'Mixte / libre' },
]

const { mutate: createCategory, isPending: isCreating } = useMutation({
  mutationFn: () => categoriesApi.create(props.competitionId, { label: form.label, sex: form.sex }),
  onSuccess: async () => {
    form.label = ''
    await refresh()
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
  const result = createCategoryInputSchema.safeParse(form)
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  createCategory()
}

const { mutate: reorder } = useMutation({
  mutationFn: (orderedIds: string[]) => categoriesApi.reorder(props.competitionId, orderedIds),
  onSuccess: async () => refresh(),
})

function move(index: number, delta: number): void {
  if (!categories.value) return
  const target = index + delta
  if (target < 0 || target >= categories.value.length) return
  const ids = categories.value.map((c) => c.id)
  const [moved] = ids.splice(index, 1)
  if (moved === undefined) return
  ids.splice(target, 0, moved)
  reorder(ids)
}

const confirmingDeleteId = ref<string | null>(null)
const { mutate: remove, isPending: isDeleting } = useMutation({
  mutationFn: (categoryId: string) => categoriesApi.remove(props.competitionId, categoryId),
  onSuccess: async () => {
    confirmingDeleteId.value = null
    await refresh()
    toast.show('Catégorie supprimée.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Suppression impossible.',
      'error',
    )
    confirmingDeleteId.value = null
  },
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <Button variant="secondary" :disabled="isApplyingTemplate" @click="applyTemplate()">
      {{ isApplyingTemplate ? 'Application…' : 'Appliquer le modèle FFME (U12 à Vétéran × H/F)' }}
    </Button>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="(category, index) in categories"
        :key="category.id"
        class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-2"
      >
        <div class="flex items-center gap-3">
          <span class="font-medium text-gray-900">{{ category.label }}</span>
          <Badge v-if="category.birthYearMin || category.birthYearMax">
            {{ category.birthYearMin ?? '…' }}–{{ category.birthYearMax ?? '…' }}
          </Badge>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            aria-label="Monter"
            class="min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Descendre"
            class="min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="!categories || index === categories.length - 1"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <template v-if="confirmingDeleteId === category.id">
            <Button variant="danger" :disabled="isDeleting" @click="remove(category.id)"
              >Confirmer</Button
            >
            <Button variant="secondary" @click="confirmingDeleteId = null">Annuler</Button>
          </template>
          <button
            v-else
            type="button"
            aria-label="Supprimer"
            class="min-h-12 min-w-12 rounded-lg text-lg text-red-700 hover:bg-red-50"
            @click="confirmingDeleteId = category.id"
          >
            ✕
          </button>
        </div>
      </li>
    </ul>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
      @submit.prevent="onCreate"
    >
      <h2 class="font-medium text-gray-900">Ajouter une catégorie libre</h2>
      <div class="grid grid-cols-2 gap-4">
        <TextField v-model="form.label" label="Libellé" required />
        <Select v-model="form.sex" label="Sexe" :options="sexOptions" required />
      </div>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button type="submit" :disabled="isCreating">{{ isCreating ? 'Ajout…' : 'Ajouter' }}</Button>
    </form>
  </div>
</template>
