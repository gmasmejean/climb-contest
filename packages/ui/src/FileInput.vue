<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    modelValue: File | null
    label: string
    accept?: string | undefined
    error?: string | undefined
    hint?: string | undefined
    required?: boolean
  }>(),
  {
    required: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: File | null] }>()

const id = useId()

function onChange(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('update:modelValue', input.files?.[0] ?? null)
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="text-sm font-medium text-gray-900">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-red-700">*</span>
    </label>
    <label
      :for="id"
      class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 text-base focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700"
      :class="error ? 'border-red-700' : 'border-gray-400'"
    >
      <span
        class="inline-flex min-h-8 items-center rounded-md bg-gray-100 px-3 py-1 text-sm font-medium text-gray-900"
      >
        Choisir un fichier
      </span>
      <span class="truncate text-gray-700">{{ modelValue?.name ?? 'Aucun fichier sélectionné' }}</span>
    </label>
    <input
      :id="id"
      type="file"
      class="sr-only"
      :accept="accept"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      @change="onChange"
    />
    <p v-if="hint && !error" class="text-sm text-gray-600">{{ hint }}</p>
    <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
  </div>
</template>
