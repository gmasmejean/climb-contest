<script setup lang="ts">
import { createCategoryInputSchema, type Category } from '@climbcontest/contracts'
import {
  Badge,
  Button,
  DataList,
  Select,
  TextField,
  useToast,
  type DataListColumn,
} from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi } from '../../../api/competitions'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'

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
const sexLabel = (sex: Category['sex']): string =>
  sexOptions.find((option) => option.value === sex)?.label ?? sex

const isDesktop = useMediaQuery(DESKTOP_QUERY)

/** Action de ligne compacte sous pointeur fin seulement (ADR-073). */
const rowActionClass =
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700'

/**
 * Pas de colonne triable (Lot 18) : l'ordre des catégories est celui du
 * déroulé de la compétition, posé aux flèches. Le sexe, saisi à la création,
 * n'était visible nulle part ; il prend sa colonne.
 */
const columns = computed<DataListColumn<Category>[]>(() => [
  { key: 'label', label: 'Catégorie', card: 'title', value: (row) => row.label },
  {
    key: 'sex',
    label: 'Sexe',
    card: 'hidden',
    cellClass: 'w-32',
    value: (row) => sexLabel(row.sex),
  },
  { key: 'years', label: 'Années', card: 'aside', cellClass: 'w-32' },
  { key: 'actions', label: 'Actions', card: 'actions', labelHidden: true, cellClass: 'w-48' },
])

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
    <DataList
      v-else
      :rows="categories ?? []"
      :columns="columns"
      :layout="isDesktop ? 'table' : 'cards'"
      label="Catégories, dans l’ordre de la compétition"
      empty-text="Aucune catégorie."
    >
      <template #cell-years="{ row }">
        <Badge v-if="row.birthYearMin || row.birthYearMax">
          {{ row.birthYearMin ?? '…' }}–{{ row.birthYearMax ?? '…' }}
        </Badge>
        <template v-else-if="isDesktop">—</template>
      </template>

      <template #cell-actions="{ row, index }">
        <div class="flex items-center gap-1">
          <button
            type="button"
            aria-label="Monter"
            class="fine:min-h-10 fine:min-w-10 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="index === 0"
            @click="move(index, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Descendre"
            class="fine:min-h-10 fine:min-w-10 min-h-12 min-w-12 rounded-lg text-lg hover:bg-gray-100 disabled:opacity-30"
            :disabled="!categories || index === categories.length - 1"
            @click="move(index, 1)"
          >
            ↓
          </button>
          <template v-if="confirmingDeleteId === row.id">
            <button
              v-if="isDesktop"
              type="button"
              :disabled="isDeleting"
              class="fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              @click="remove(row.id)"
            >
              Confirmer
            </button>
            <Button v-else variant="danger" :disabled="isDeleting" @click="remove(row.id)"
              >Confirmer</Button
            >
            <button
              v-if="isDesktop"
              type="button"
              :class="rowActionClass"
              @click="confirmingDeleteId = null"
            >
              Annuler
            </button>
            <Button v-else variant="secondary" @click="confirmingDeleteId = null">Annuler</Button>
          </template>
          <button
            v-else
            type="button"
            aria-label="Supprimer"
            class="fine:min-h-10 fine:min-w-10 min-h-12 min-w-12 rounded-lg text-lg text-red-700 hover:bg-red-50"
            @click="confirmingDeleteId = row.id"
          >
            ✕
          </button>
        </div>
      </template>
    </DataList>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
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
