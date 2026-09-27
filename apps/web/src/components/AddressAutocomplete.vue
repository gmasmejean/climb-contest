<script setup lang="ts">
import type { Address } from '@climbcontest/contracts'
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'

import { BAN_SEARCH_DELAY_MS, normalizeBanQuery, searchAddresses } from '../lib/ban'

/**
 * Adresse autocomplétée par la Base Adresse Nationale (ADR-088). Combobox au
 * sens ARIA 1.2 : flèches pour parcourir, Entrée pour choisir, Échap pour
 * fermer. Choisir une proposition donne une adresse localisée ; ce qui est
 * tapé sans choisir (ou quand le service ne répond pas) est gardé tel quel,
 * sans position : la saisie n'est jamais bloquée par le service.
 * Réutilisé pour le lieu des compétitions (Lot 26).
 */

const props = defineProps<{
  modelValue: Address | null
  label: string
  hint?: string | undefined
  error?: string | undefined
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Address | null] }>()

const SERVICE_DOWN_MESSAGE =
  'Le service d’adresses ne répond pas. Votre adresse sera enregistrée telle que vous l’avez écrite, sans carte.'

const id = useId()
const listboxId = `${id}-listbox`
const statusId = `${id}-status`
const hintId = `${id}-hint`
const errorId = `${id}-error`

const text = ref(props.modelValue?.label ?? '')
const suggestions = ref<Address[]>([])
const open = ref(false)
const activeIndex = ref(-1)
const serviceDown = ref(false)

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | null = null

// La fiche arrive après le montage (requête), ou est rechargée après un
// enregistrement : le champ suit, sans relancer de recherche.
watch(
  () => props.modelValue?.label ?? '',
  (label) => {
    if (label !== text.value.trim()) text.value = label
  },
)

function cancelSearch(): void {
  clearTimeout(timer)
  controller?.abort()
  controller = null
}

function close(): void {
  open.value = false
  activeIndex.value = -1
}

async function runSearch(query: string): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  try {
    const results = await searchAddresses(query, current.signal)
    if (current.signal.aborted) return
    serviceDown.value = false
    suggestions.value = results
    activeIndex.value = -1
    open.value = results.length > 0
  } catch {
    // Une recherche remplacée par une plus récente n'est pas une panne.
    if (current.signal.aborted) return
    serviceDown.value = true
    suggestions.value = []
    close()
  }
}

function onInput(event: Event): void {
  if (!(event.target instanceof HTMLInputElement)) return
  text.value = event.target.value
  const label = text.value.trim()
  emit(
    'update:modelValue',
    label === ''
      ? null
      : { label, postcode: null, city: null, latitude: null, longitude: null, banId: null },
  )

  cancelSearch()
  const query = normalizeBanQuery(text.value)
  if (query === null) {
    suggestions.value = []
    close()
    return
  }
  timer = setTimeout(() => void runSearch(query), BAN_SEARCH_DELAY_MS)
}

function select(address: Address): void {
  cancelSearch()
  text.value = address.label
  emit('update:modelValue', address)
  suggestions.value = []
  close()
}

function onKeydown(event: KeyboardEvent): void {
  const count = suggestions.value.length
  if (event.key === 'ArrowDown' && count > 0) {
    event.preventDefault()
    open.value = true
    activeIndex.value = (activeIndex.value + 1) % count
  } else if (event.key === 'ArrowUp' && count > 0) {
    event.preventDefault()
    open.value = true
    activeIndex.value = activeIndex.value <= 0 ? count - 1 : activeIndex.value - 1
  } else if (event.key === 'Enter' && open.value) {
    const chosen = suggestions.value[activeIndex.value]
    if (chosen) {
      event.preventDefault()
      select(chosen)
    }
  } else if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close()
  }
}

onBeforeUnmount(cancelSearch)

const optionId = (index: number) => `${id}-option-${index}`
const activeDescendant = computed(() =>
  open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined,
)

const located = computed(() => props.modelValue !== null && props.modelValue.latitude !== null)
const status = computed(() => {
  if (props.modelValue === null) return null
  if (serviceDown.value && !located.value) return SERVICE_DOWN_MESSAGE
  return located.value
    ? 'Adresse localisée : elle s’affichera sur une carte.'
    : 'Adresse non localisée : choisissez une proposition pour afficher une carte.'
})
const announcement = computed(() => {
  if (!open.value) return ''
  const count = suggestions.value.length
  return count === 1 ? '1 adresse proposée.' : `${count} adresses proposées.`
})
const describedBy = computed(
  () =>
    [props.error ? errorId : null, props.hint ? hintId : null, status.value ? statusId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined,
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" class="text-sm font-medium text-gray-900">{{ label }}</label>
    <!-- La liste s'ouvre juste sous le champ, par-dessus les textes d'aide. -->
    <div class="relative">
      <input
        :id="id"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listboxId"
        :aria-activedescendant="activeDescendant"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :value="text"
        class="min-h-12 w-full rounded-lg border bg-white px-4 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        :class="error ? 'border-red-700' : 'border-gray-400'"
        @input="onInput"
        @keydown="onKeydown"
        @blur="close"
      />
      <ul
        v-show="open"
        :id="listboxId"
        role="listbox"
        :aria-label="`Propositions pour ${label}`"
        class="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-gray-300 bg-white py-1 shadow-lg"
      >
        <li
          v-for="(address, index) in suggestions"
          :id="optionId(index)"
          :key="address.banId ?? address.label"
          role="option"
          :aria-selected="index === activeIndex"
          class="flex min-h-12 cursor-pointer items-center px-4 py-2 text-base"
          :class="
            index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-gray-900 hover:bg-gray-100'
          "
          @mousedown.prevent="select(address)"
        >
          {{ address.label }}
        </li>
      </ul>
    </div>
    <p v-if="hint && !error" :id="hintId" class="text-sm text-gray-600">{{ hint }}</p>
    <p
      v-if="status"
      :id="statusId"
      class="text-sm"
      :class="serviceDown && !located ? 'text-amber-800' : 'text-gray-600'"
    >
      {{ status }}
    </p>
    <p v-if="error" :id="errorId" role="alert" class="text-sm text-red-700">{{ error }}</p>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
