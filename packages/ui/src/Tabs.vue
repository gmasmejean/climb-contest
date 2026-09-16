<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  tabs: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function select(id: string): void {
  emit('update:modelValue', id)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  const currentIndex = props.tabs.findIndex((tab) => tab.id === props.modelValue)
  if (currentIndex === -1) return
  const delta = event.key === 'ArrowRight' ? 1 : -1
  const nextIndex = (currentIndex + delta + props.tabs.length) % props.tabs.length
  const next = props.tabs[nextIndex]
  if (next) {
    event.preventDefault()
    select(next.id)
  }
}
</script>

<template>
  <div role="tablist" class="flex gap-1 overflow-x-auto border-b border-gray-200" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :id="`tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      :aria-selected="tab.id === modelValue"
      :aria-controls="`panel-${tab.id}`"
      :tabindex="tab.id === modelValue ? 0 : -1"
      class="min-h-12 shrink-0 border-b-2 px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      :class="
        tab.id === modelValue
          ? 'border-blue-700 text-blue-700'
          : 'border-transparent text-gray-600 hover:text-gray-900'
      "
      @click="select(tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
