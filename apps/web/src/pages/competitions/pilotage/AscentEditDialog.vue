<script setup lang="ts">
import { Button, Modal, NumberField, Select, TextField } from '@climbcontest/ui'
import { computed, ref, watch } from 'vue'

import type { AscentEditTarget } from './ascent-edit'

/**
 * Correction d'un passage (motif obligatoire, ADR-049) et saisie de secours
 * (l'organisateur note à la place d'un juge). Extrait de `PilotageAscents` au
 * Lot 20, sans changement de comportement : la matrice compétiteurs × voies
 * ouvre exactement le même formulaire, et deux copies auraient divergé.
 */
const props = defineProps<{
  /** `null` = fermé. Sert de valeur de départ, jamais modifié ici. */
  target: AscentEditTarget | null
  error: string
  busy: boolean
}>()

const emit = defineEmits<{ submit: [value: AscentEditTarget]; close: [] }>()

/*
 * Le formulaire travaille sur sa PROPRE copie : annuler ne doit rien laisser
 * derrière dans l'état de l'appelant, et une grille de 150 cases ne doit pas
 * garder la trace d'un demi-remplissage sur la case qu'on vient de fermer.
 */
const form = ref<AscentEditTarget | null>(null)
watch(
  () => props.target,
  (target) => {
    form.value = target === null ? null : { ...target }
  },
  { immediate: true },
)

function submit(): void {
  if (form.value) emit('submit', form.value)
}

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Validé' },
  { value: 'dns', label: 'DNS — absent' },
  { value: 'dnf', label: 'DNF — abandon en cours' },
  { value: 'dsq', label: 'DSQ — disqualifié' },
]
const MODIFIER_OPTIONS = [
  { value: 'none', label: 'Neutre' },
  { value: 'plus', label: '+' },
]

const title = computed(() =>
  form.value?.mode === 'correct' ? 'Corriger le passage' : 'Saisie de secours',
)
</script>

<template>
  <Modal :open="form !== null" :title="title" @close="emit('close')">
    <form v-if="form" class="flex flex-col gap-4" @submit.prevent="submit">
      <p class="font-medium text-gray-900" data-testid="ascent-edit-subject">
        {{ form.subject }}
      </p>
      <Select v-model="form.status" label="Statut" :options="STATUS_OPTIONS" required />
      <template v-if="form.status === 'valid'">
        <label class="flex min-h-12 items-center gap-2">
          <input v-model="form.isTop" type="checkbox" class="h-5 w-5 rounded border-gray-400" />
          <span class="text-sm text-gray-900">TOP</span>
        </label>
        <template v-if="!form.isTop">
          <NumberField
            v-model="form.holdNumber"
            label="Numéro de prise"
            :min="1"
            :max="form.holdCount ?? undefined"
            required
          />
          <Select v-model="form.modifier" label="Modificateur" :options="MODIFIER_OPTIONS" />
        </template>
      </template>
      <TextField
        v-if="form.mode === 'correct'"
        v-model="form.reason"
        label="Motif (obligatoire)"
        required
      />
      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
      <div class="flex gap-2">
        <Button type="submit" :disabled="busy">
          {{ busy ? 'Enregistrement…' : 'Enregistrer' }}
        </Button>
        <Button type="button" variant="secondary" @click="emit('close')">Annuler</Button>
      </div>
    </form>
  </Modal>
</template>
