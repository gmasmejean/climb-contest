<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  watch,
  type ComponentPublicInstance,
} from 'vue'

import type { GalleryPhoto } from '../lib/organization-photos'

/**
 * Photos de l'organisation dans son encart (ADR-090 point 9) : une grille de
 * vignettes, chargées seulement quand on descend jusqu'à elles, et la photo
 * entière en grand au toucher, avec « Précédente », « Suivante » et « Fermer »
 * (pas de balayage : pas de geste caché).
 */

const props = defineProps<{
  photos: readonly GalleryPhoto[]
  organizationName: string
}>()

const titleId = useId()
const openIndex = ref<number | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const thumbnails: HTMLButtonElement[] = []

function thumbnailRef(index: number) {
  return (el: Element | ComponentPublicInstance | null): void => {
    if (el instanceof HTMLButtonElement) thumbnails[index] = el
  }
}

const current = computed(() =>
  openIndex.value === null ? null : (props.photos[openIndex.value] ?? null),
)

async function open(index: number): Promise<void> {
  openIndex.value = index
  document.addEventListener('keydown', onKeydown)
  await nextTick()
  closeButton.value?.focus()
}

function close(): void {
  const index = openIndex.value
  openIndex.value = null
  document.removeEventListener('keydown', onKeydown)
  // Le focus revient à la vignette ouverte, pas en haut de la page.
  if (index !== null) thumbnails[index]?.focus()
}

function step(delta: -1 | 1): void {
  if (openIndex.value === null || props.photos.length === 0) return
  openIndex.value = (openIndex.value + delta + props.photos.length) % props.photos.length
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
  else if (event.key === 'ArrowLeft') step(-1)
  else if (event.key === 'ArrowRight') step(1)
}

// Une photo retirée pendant qu'on la regarde (écran de l'owner) : on referme.
watch(
  () => props.photos.length,
  (length) => {
    if (openIndex.value !== null && openIndex.value >= length) close()
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

const navButtonClass =
  'min-h-12 min-w-12 rounded-lg bg-white/10 px-4 font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white'
</script>

<template>
  <div v-if="photos.length > 0">
    <ul class="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Photos">
      <li v-for="(photo, index) in photos" :key="photo.id">
        <button
          :ref="thumbnailRef(index)"
          type="button"
          class="block aspect-[4/3] w-full overflow-hidden rounded-lg bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          data-testid="organization-photo"
          @click="open(index)"
        >
          <span class="sr-only">Agrandir : </span>
          <img
            v-if="photo.src"
            :src="photo.src"
            :alt="photo.alt"
            loading="lazy"
            decoding="async"
            class="size-full object-cover"
          />
          <span v-else class="flex size-full items-center justify-center p-2 text-sm text-gray-600">
            {{ photo.alt }}
          </span>
        </button>
      </li>
    </ul>

    <Teleport to="body">
      <div
        v-if="current"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
        data-testid="organization-photo-viewer"
        @click.self="close"
      >
        <div class="flex items-center justify-between gap-4 text-white">
          <h2 :id="titleId" class="text-base font-medium">
            {{ organizationName }} — photo {{ (openIndex ?? 0) + 1 }} sur {{ photos.length }}
          </h2>
          <button ref="closeButton" type="button" :class="navButtonClass" @click="close">
            Fermer
          </button>
        </div>
        <figure class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-4">
          <img
            v-if="current.src"
            :src="current.src"
            :alt="current.alt"
            class="max-h-full min-h-0 max-w-full object-contain"
          />
          <p v-else class="text-white">{{ current.alt }}</p>
          <figcaption v-if="current.caption" class="text-center text-white">
            {{ current.caption }}
          </figcaption>
        </figure>
        <div v-if="photos.length > 1" class="flex justify-center gap-4">
          <button type="button" :class="navButtonClass" @click="step(-1)">Précédente</button>
          <button type="button" :class="navButtonClass" @click="step(1)">Suivante</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
