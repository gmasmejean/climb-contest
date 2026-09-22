<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type { TabBadge, TabItem as Tab } from './tabs'

const props = withDefaults(
  defineProps<{
    modelValue: string
    tabs: Tab[]
    orientation?: 'horizontal' | 'vertical'
  }>(),
  { orientation: 'horizontal' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const tablist = ref<HTMLElement | null>(null)

/** Onglets consécutifs de même `group`, dans l'ordre reçu. */
const sections = computed(() => {
  const result: Array<{ group: string | undefined; tabs: Tab[] }> = []
  for (const tab of props.tabs) {
    const last = result.at(-1)
    if (last && last.group === tab.group) {
      last.tabs.push(tab)
    } else {
      result.push({ group: tab.group, tabs: [tab] })
    }
  }
  return result
})

function select(id: string): void {
  emit('update:modelValue', id)
}

// Les deux axes répondent dans les deux orientations : à 1023 px la barre
// latérale redevient une rangée, l'habitude du clavier ne doit pas changer.
const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

const BADGE_TONES: Record<NonNullable<TabBadge['tone']>, string> = {
  neutral: 'bg-gray-100 text-gray-900',
  warning: 'bg-amber-700 text-white',
  danger: 'bg-red-700 text-white',
}

/**
 * La pastille est `aria-hidden` et son sens passe par le nom accessible du
 * bouton. Sans ça, « 2 » entrerait dans le nom (« Pilotage 2 ») : illisible au
 * lecteur d'écran, et les parcours e2e ciblent tous `getByRole('tab', { name })`.
 */
function tabLabel(tab: Tab): string | undefined {
  return tab.badge ? `${tab.label}, ${tab.badge.label}` : undefined
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  const delta = STEPS[event.key]
  if (delta === undefined) return
  const currentIndex = props.tabs.findIndex((tab) => tab.id === props.modelValue)
  if (currentIndex === -1) return
  const nextIndex = (currentIndex + delta + props.tabs.length) % props.tabs.length
  const next = props.tabs[nextIndex]
  if (!next) return
  event.preventDefault()
  select(next.id)
  // Le focus suit la sélection, sinon il reste sur un onglet passé en tabindex=-1.
  await nextTick()
  tablist.value?.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus()
}
</script>

<template>
  <div
    ref="tablist"
    role="tablist"
    :aria-orientation="orientation"
    class="flex gap-1"
    :class="orientation === 'vertical' ? 'flex-col' : 'overflow-x-auto border-b border-gray-200'"
    @keydown="onKeydown"
  >
    <template v-for="(section, index) in sections" :key="index">
      <p
        v-if="orientation === 'vertical' && section.group"
        role="presentation"
        class="px-4 pt-4 pb-1 text-xs font-semibold tracking-wide text-gray-600 uppercase first:pt-0"
      >
        {{ section.group }}
      </p>
      <button
        v-for="tab in section.tabs"
        :id="`tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="tab.id === modelValue"
        :aria-controls="`panel-${tab.id}`"
        :tabindex="tab.id === modelValue ? 0 : -1"
        :aria-label="tabLabel(tab)"
        class="inline-flex min-h-12 shrink-0 items-center gap-2 px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        :class="[
          orientation === 'vertical'
            ? 'w-full justify-between rounded-lg text-left'
            : 'justify-center border-b-2',
          tab.id === modelValue
            ? orientation === 'vertical'
              ? 'bg-blue-50 text-blue-700'
              : 'border-blue-700 text-blue-700'
            : orientation === 'vertical'
              ? 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              : 'border-transparent text-gray-600 hover:text-gray-900',
        ]"
        @click="select(tab.id)"
      >
        <span class="min-w-0 truncate">{{ tab.label }}</span>
        <span
          v-if="tab.badge"
          aria-hidden="true"
          class="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums"
          :class="BADGE_TONES[tab.badge.tone ?? 'neutral']"
        >
          {{ tab.badge.count }}
        </span>
      </button>
    </template>
  </div>
</template>
