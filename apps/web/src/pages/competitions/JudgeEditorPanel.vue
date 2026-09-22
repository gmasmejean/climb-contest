<script setup lang="ts">
import {
  createJudgeInputSchema,
  updateJudgeInputSchema,
  type JudgeCreated,
} from '@climbcontest/contracts'
import { Button } from '@climbcontest/ui'
import { useMutation } from '@tanstack/vue-query'
import { reactive, ref, watch } from 'vue'

import { ApiError } from '../../api/client'
import { judgesApi, revealedJudgeTokens, type JudgeWithRoutes } from '../../api/judges'
import type { RouteWithCategories } from '../../api/competitions'

/**
 * Création et modification d'un juge. Un seul mode à la fois (comme
 * `RouteEditorPanel`, ADR-075 point 8) : `judge` désigne le juge modifié,
 * `null` veut dire « ajouter ».
 */
const props = defineProps<{
  competitionId: string
  judge: JudgeWithRoutes | null
  routes: RouteWithCategories[]
}>()
const emit = defineEmits<{ saved: [created?: JudgeCreated]; cancel: [] }>()

function emptyForm() {
  return { displayName: '', email: '', routeIds: [] as string[] }
}
const form = reactive(emptyForm())
const formError = ref('')

watch(
  () => props.judge?.id ?? null,
  (id) => {
    formError.value = ''
    const judge = props.judge
    if (id === null || !judge) {
      Object.assign(form, emptyForm())
      return
    }
    form.displayName = judge.displayName
    form.email = judge.email ?? ''
    form.routeIds = [...judge.routeIds]
  },
  { immediate: true },
)

const createMutation = useMutation({
  mutationFn: () =>
    judgesApi.create(props.competitionId, {
      displayName: form.displayName,
      routeIds: form.routeIds,
      email: form.email || undefined,
    }),
  onSuccess: (created) => {
    Object.assign(form, emptyForm())
    emit('saved', created)
    // Gardé en mémoire même quand le serveur stocke déjà le clair : c'est ce
    // qui permet d'inclure ce juge dans une planche téléchargée plus tard
    // dans la même session sans attendre le prochain rechargement de la liste.
    revealedJudgeTokens.value.push({
      competitionId: props.competitionId,
      judgeId: created.id,
      accessToken: created.accessToken,
    })
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

const updateMutation = useMutation({
  mutationFn: () =>
    judgesApi.update(props.competitionId, props.judge?.id ?? '', {
      displayName: form.displayName,
      routeIds: form.routeIds,
      email: form.email || null,
    }),
  onSuccess: () => emit('saved'),
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onSubmit(): void {
  formError.value = ''
  if (props.judge) {
    const result = updateJudgeInputSchema.safeParse({
      displayName: form.displayName,
      routeIds: form.routeIds,
      email: form.email || null,
    })
    if (!result.success) {
      formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
      return
    }
    updateMutation.mutate()
    return
  }
  const result = createJudgeInputSchema.safeParse({
    displayName: form.displayName,
    routeIds: form.routeIds,
    email: form.email || undefined,
  })
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  createMutation.mutate()
}

function onCancel(): void {
  Object.assign(form, emptyForm())
  formError.value = ''
  emit('cancel')
}
</script>

<template>
  <form
    class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
    @submit.prevent="onSubmit"
  >
    <h2 class="font-medium text-gray-900">{{ props.judge ? 'Modifier le juge' : 'Ajouter un juge' }}</h2>
    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium text-gray-900">Nom affiché</span>
      <input
        v-model="form.displayName"
        type="text"
        class="min-h-12 rounded-lg border border-gray-400 bg-white px-3 text-base"
        required
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-sm font-medium text-gray-900">E-mail (optionnel)</span>
      <input
        v-model="form.email"
        type="email"
        placeholder="pour envoyer ou renvoyer le lien d'accès"
        class="min-h-12 rounded-lg border border-gray-400 bg-white px-3 text-base"
      />
    </label>
    <fieldset class="flex flex-col gap-2">
      <legend class="text-sm font-medium text-gray-900">Voies assignées</legend>
      <label v-for="r in props.routes" :key="r.id" class="flex min-h-12 items-center gap-2">
        <input
          v-model="form.routeIds"
          type="checkbox"
          :value="r.id"
          class="h-5 w-5 rounded border-gray-400"
        />
        Voie {{ r.number }}<span v-if="r.name"> — {{ r.name }}</span>
      </label>
      <p v-if="props.routes.length === 0" class="text-sm text-gray-600">
        Créez d'abord une voie dans l'onglet « Voies ».
      </p>
      <p v-if="props.judge" class="text-sm text-gray-600">
        Retirer une voie coupe aussitôt l'accès du juge à sa notation — sans toucher aux passages
        déjà saisis.
      </p>
    </fieldset>
    <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
    <div class="flex gap-3">
      <Button type="submit" :disabled="createMutation.isPending.value || updateMutation.isPending.value">
        {{
          props.judge
            ? updateMutation.isPending.value
              ? 'Enregistrement…'
              : 'Enregistrer'
            : createMutation.isPending.value
              ? 'Création…'
              : 'Créer le juge'
        }}
      </Button>
      <Button v-if="props.judge" variant="secondary" @click="onCancel">Annuler</Button>
    </div>
  </form>
</template>
