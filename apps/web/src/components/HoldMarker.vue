<script setup lang="ts">
import { computed } from 'vue'

/**
 * Une prise annotée sur une photo (ADR-066) : un anneau sur la prise et son
 * numéro dans une pastille blanche à côté. L'anneau ne recouvre pas la prise,
 * et l'ensemble reste lisible en plein soleil comme sur un mur sombre (blanc /
 * jaune cerclé de noir). Purement visuel : à placer dans un conteneur
 * `relative` qui a la taille de la photo — `x` et `y` sont normalisés dans [0, 1].
 */
const props = defineProps<{ number: number; x: number; y: number; selected?: boolean }>()

// Le numéro se met à droite de la prise, à gauche près du bord droit de la photo.
const labelOnLeft = computed(() => props.x > 0.8)
</script>

<template>
  <span
    class="pointer-events-none absolute h-0 w-0"
    :style="{ left: `${props.x * 100}%`, top: `${props.y * 100}%` }"
    data-testid="hold-marker"
    :data-number="props.number"
  >
    <span
      class="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px]"
      :class="props.selected ? 'border-white bg-blue-600/40' : 'border-yellow-300'"
      style="
        box-shadow:
          0 0 0 2px #000,
          inset 0 0 0 1px #000;
      "
    />
    <span
      class="absolute -translate-y-1/2 rounded bg-white px-1.5 text-sm leading-6 font-bold text-black"
      :class="labelOnLeft ? 'right-[18px]' : 'left-[18px]'"
      style="box-shadow: 0 0 0 2px #000"
    >
      {{ props.number }}
    </span>
  </span>
</template>
