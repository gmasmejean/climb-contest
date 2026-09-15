<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label: string
    type?: 'text' | 'email' | 'password'
    error?: string | undefined
    hint?: string | undefined
    required?: boolean
    autocomplete?: string | undefined
  }>(),
  {
    type: 'text',
    required: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const id = useId()
const errorId = computed(() => `${id}-error`)
const hintId = computed(() => `${id}-hint`)
const describedBy = computed(() =>
  [props.error ? errorId.value : null, props.hint ? hintId.value : null]
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
    <input
      :id="id"
      :type="type"
      :value="modelValue"
      :required="required"
      :autocomplete="autocomplete"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="min-h-12 rounded-lg border px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      :class="error ? 'border-red-700' : 'border-gray-400'"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="hint && !error" :id="hintId" class="text-sm text-gray-600">{{ hint }}</p>
    <p v-if="error" :id="errorId" role="alert" class="text-sm text-red-700">{{ error }}</p>
  </div>
</template>
