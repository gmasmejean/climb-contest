<script setup lang="ts">
/**
 * Le « gros pavé numérique » (ROADMAP.md Lot 5) : un clavier natif
 * (`NumberField`) est écarté ici — mains froides/mouillées/gantées et
 * soleil direct sur un clavier système sont exactement les conditions
 * visées par CLAUDE.md, et ce clavier borne la saisie par construction
 * ([1, max]) au lieu de la valider après coup comme `min`/`max` natifs.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    min: number
    max: number
    disabled?: boolean
  }>(),
  {
    disabled: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

function currentDraft(): string {
  return props.modelValue === null ? '' : String(props.modelValue)
}

function pressDigit(digit: string): void {
  if (props.disabled) return
  const draft = currentDraft()
  // Pas de zéro en tête : aucune prise valide ne porte le numéro 0.
  if (draft === '' && digit === '0') return
  const next = draft + digit
  const value = Number(next)
  // Garde d'entrée : une frappe qui dépasserait `max` est refusée d'emblée,
  // plutôt que signalée après coup.
  if (value > props.max) return
  emit('update:modelValue', value)
}

function backspace(): void {
  if (props.disabled) return
  const draft = currentDraft()
  const next = draft.slice(0, -1)
  emit('update:modelValue', next === '' ? null : Number(next))
}

function clear(): void {
  if (props.disabled) return
  emit('update:modelValue', null)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      role="spinbutton"
      aria-live="polite"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="modelValue ?? undefined"
      class="min-h-16 rounded-xl border border-gray-400 px-4 text-center text-4xl font-semibold tracking-wide text-gray-900"
      :class="disabled ? 'opacity-50' : ''"
    >
      {{ modelValue ?? '—' }}
    </div>
    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="digit in digits"
        :key="digit || 'blank'"
        type="button"
        :disabled="disabled || digit === ''"
        class="min-h-16 min-w-16 rounded-xl border border-gray-300 text-2xl font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-default disabled:border-transparent disabled:opacity-0"
        :class="digit ? 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200' : ''"
        @click="digit === '⌫' ? backspace() : pressDigit(digit)"
      >
        {{ digit }}
      </button>
    </div>
    <button
      type="button"
      :disabled="disabled || modelValue === null"
      class="min-h-12 text-sm font-medium text-blue-700 hover:underline disabled:cursor-default disabled:text-gray-400 disabled:no-underline"
      @click="clear"
    >
      Effacer
    </button>
  </div>
</template>
