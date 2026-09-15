<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    modelValue: string
    label: string
    options: Array<{ value: string; label: string }>
    error?: string | undefined
    required?: boolean
  }>(),
  {
    required: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const id = useId()
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="text-sm font-medium text-gray-900">
      {{ label }}
      <span v-if="required" aria-hidden="true" class="text-red-700">*</span>
    </label>
    <select
      :id="id"
      :value="modelValue"
      :required="required"
      :aria-invalid="error ? 'true' : undefined"
      class="min-h-12 rounded-lg border bg-white px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      :class="error ? 'border-red-700' : 'border-gray-400'"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
  </div>
</template>
