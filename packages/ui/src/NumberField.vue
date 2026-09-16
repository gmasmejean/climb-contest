<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number | null
    label: string
    min?: number | undefined
    max?: number | undefined
    step?: number | undefined
    error?: string | undefined
    hint?: string | undefined
    required?: boolean
  }>(),
  {
    required: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)
const describedBy = computed(() =>
  [props.error ? errorId.value : null, props.hint ? hintId.value : null]
    .filter((value): value is string => value !== null)
    .join(' ') || undefined,
)

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update:modelValue', raw === '' ? null : Number(raw))
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="text-sm font-medium text-gray-900">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-red-700">*</span>
    </label>
    <input
      :id="id"
      type="number"
      inputmode="numeric"
      :value="modelValue ?? ''"
      :min="min"
      :max="max"
      :step="step ?? 1"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="min-h-12 rounded-lg border px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      :class="error ? 'border-red-700' : 'border-gray-400'"
      @input="onInput"
    />
    <p v-if="hint && !error" :id="hintId" class="text-sm text-gray-600">{{ hint }}</p>
    <p v-if="error" :id="errorId" role="alert" class="text-sm text-red-700">{{ error }}</p>
  </div>
</template>
