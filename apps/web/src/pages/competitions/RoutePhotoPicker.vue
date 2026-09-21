<script setup lang="ts">
import { Button, FileInput } from '@climbcontest/ui'
import { onBeforeUnmount, ref, watch } from 'vue'

import PhotoCropDialog from '../../components/PhotoCropDialog.vue'
import type { CropRect, PickedPhoto } from '../../lib/photo-crop'
import { PhotoUnreadableError, resizeToJpeg } from '../../lib/photo-resize'

/**
 * Choix de la photo d'une voie, puis recadrage facultatif (ADR-067). L'aperçu est
 * produit par le même `resizeToJpeg` que l'envoi : ce qu'on voit est ce qui sera
 * envoyé. Un fichier illisible est refusé dès le choix, pas au moment d'envoyer.
 * Ne change rien côté serveur : l'appelant reçoit `{ file, crop }`. Deux
 * emplacements laissent l'appelant composer son déroulé (ADR-068) : `preview`
 * (l'aperçu, par défaut une image) et `actions` (les boutons de recadrage).
 */
const props = defineProps<{
  modelValue: PickedPhoto | null
  label: string
  hint?: string | undefined
}>()
const emit = defineEmits<{
  'update:modelValue': [value: PickedPhoto | null]
  /** L'utilisateur a validé le dialogue de recadrage (zone, ou `null` : photo entière). */
  'crop-applied': [crop: CropRect | null]
}>()

const PREVIEW_SIDE = 640
const PREVIEW_QUALITY = 0.7

const error = ref('')
const previewUrl = ref<string | null>(null)
const originalUrl = ref<string | null>(null)
const cropping = ref(false)
// Remonter le champ fichier le vide vraiment : sans cela, choisir de nouveau le
// même fichier (la photo d'un mur commun à plusieurs voies) ne déclenche rien.
const inputKey = ref(0)
let previewToken = 0

function onFile(file: File | null): void {
  error.value = ''
  emit('update:modelValue', file ? { file, crop: null } : null)
}

function setCrop(crop: CropRect | null): void {
  if (props.modelValue) emit('update:modelValue', { file: props.modelValue.file, crop })
}
function openCrop(): void {
  cropping.value = true
}
function onDialogApply(crop: CropRect | null): void {
  cropping.value = false
  setCrop(crop)
  emit('crop-applied', crop)
}

function releasePreview(): void {
  if (previewUrl.value !== null) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

watch(
  () => props.modelValue?.file ?? null,
  (file) => {
    if (originalUrl.value !== null) URL.revokeObjectURL(originalUrl.value)
    originalUrl.value = file ? URL.createObjectURL(file) : null
    if (!file) inputKey.value += 1
  },
  { immediate: true },
)

watch(
  () => props.modelValue,
  async (picked) => {
    const token = (previewToken += 1)
    releasePreview()
    if (!picked) return
    try {
      const blob = await resizeToJpeg(picked.file, {
        crop: picked.crop,
        maxSide: PREVIEW_SIDE,
        quality: PREVIEW_QUALITY,
      })
      if (token === previewToken) previewUrl.value = URL.createObjectURL(blob)
    } catch (caught) {
      if (token !== previewToken) return
      error.value =
        caught instanceof PhotoUnreadableError
          ? caught.message
          : 'Cette photo ne peut pas être lue. Choisissez-en une autre.'
      emit('update:modelValue', null)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  previewToken += 1
  releasePreview()
  if (originalUrl.value !== null) URL.revokeObjectURL(originalUrl.value)
})
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="photo-picker">
    <FileInput
      :key="inputKey"
      :model-value="props.modelValue?.file ?? null"
      :label="props.label"
      accept="image/*"
      :hint="props.hint"
      :error="error || undefined"
      @update:model-value="onFile"
    />

    <div v-if="props.modelValue" class="flex flex-col gap-2">
      <slot v-if="previewUrl" name="preview" :url="previewUrl">
        <img
          :src="previewUrl"
          alt="Aperçu de la photo qui sera envoyée"
          class="max-h-64 max-w-full self-start rounded-lg border border-gray-300 bg-white"
          data-testid="photo-preview"
        />
      </slot>
      <p v-else role="status" class="text-sm text-gray-700">Préparation de l'aperçu…</p>

      <slot
        name="actions"
        :crop="props.modelValue.crop"
        :ready="previewUrl !== null"
        :open-crop="openCrop"
        :clear-crop="() => setCrop(null)"
      >
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="secondary" :disabled="!previewUrl" @click="openCrop">
            {{ props.modelValue.crop ? 'Modifier le recadrage' : 'Recadrer la photo' }}
          </Button>
          <Button v-if="props.modelValue.crop" variant="secondary" @click="setCrop(null)">
            Retirer le recadrage
          </Button>
        </div>
        <p v-if="props.modelValue.crop" class="text-sm text-gray-700">
          La photo sera recadrée avant l'envoi.
        </p>
      </slot>
    </div>

    <PhotoCropDialog
      v-if="props.modelValue && originalUrl"
      :open="cropping"
      :image-url="originalUrl"
      :crop="props.modelValue.crop"
      @apply="onDialogApply"
      @close="cropping = false"
    />
  </div>
</template>
