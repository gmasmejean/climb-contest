<script setup lang="ts">
import { computed, useId } from 'vue'

/**
 * Texte long (description d'une organisation, ADR-088). Même présentation que
 * `TextField` ; avec `maxlength`, un compteur dit ce qu'il reste, plutôt
 * qu'un refus découvert à l'enregistrement.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    error?: string | undefined
    hint?: string | undefined
    required?: boolean
    rows?: number
    maxlength?: number | undefined
  }>(),
  {
    required: false,
    rows: 5,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)
const counterId = computed(() => `${id}-counter`)
const describedBy = computed(
  () =>
    [
      props.error ? errorId.value : null,
      props.hint ? hintId.value : null,
      props.maxlength ? counterId.value : null,
    ]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="text-sm font-medium text-gray-900">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-red-700">*</span>
    </label>
    <textarea
      :id="id"
      :value="modelValue"
      :rows="rows"
      :maxlength="maxlength"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="rounded-lg border bg-white px-4 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      :class="error ? 'border-red-700' : 'border-gray-400'"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <p v-if="hint && !error" :id="hintId" class="text-sm text-gray-600">{{ hint }}</p>
    <p v-if="maxlength" :id="counterId" class="text-sm text-gray-600">
      {{ modelValue.length.toLocaleString('fr-FR') }} / {{ maxlength.toLocaleString('fr-FR') }}
      caractères
    </p>
    <p v-if="error" :id="errorId" role="alert" class="text-sm text-red-700">{{ error }}</p>
  </div>
</template>
