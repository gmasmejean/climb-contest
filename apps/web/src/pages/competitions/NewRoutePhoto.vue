<script setup lang="ts">
import type { RouteHold } from '@climbcontest/contracts'
import { Button, Modal } from '@climbcontest/ui'
import { computed, ref, watch } from 'vue'

import HoldAnnotator from '../../components/HoldAnnotator.vue'
import HoldAnnotatorDialog from '../../components/HoldAnnotatorDialog.vue'
import type { PickedPhoto } from '../../lib/photo-crop'
import RoutePhotoPicker from './RoutePhotoPicker.vue'

/**
 * Photo d'une voie qu'on est en train de créer (ADR-068), en trois temps dans
 * cet ordre : 1. choisir l'image ; 2. décider de la recadrer ou non ; 3. y placer
 * les prises. Les prises se placent sur l'image FINALE, recadrage compris : revenir
 * au recadrage depuis le placement les efface, après confirmation. Rien n'est
 * envoyé ici : l'appelant reçoit la photo choisie et les prises (`v-model`).
 */
const props = defineProps<{ routeNumber: number | null }>()
const picked = defineModel<PickedPhoto | null>('picked', { required: true })
const holds = defineModel<RouteHold[]>('holds', { required: true })

const stage = ref<'crop' | 'annotate'>('crop')
const confirmingRecrop = ref(false)
// Placement en plein écran (ADR-077), à toutes les largeurs.
const annotating = ref(false)

// Autre fichier, ou champ vidé (voie créée) : on reprend au début, sans prises.
watch(
  () => picked.value?.file ?? null,
  () => {
    stage.value = 'crop'
    holds.value = []
  },
)

const effaceMessage = computed(() =>
  holds.value.length > 1
    ? `Les ${holds.value.length} prises placées seront effacées : elles ne correspondraient plus à la photo recadrée. Il faudra les replacer.`
    : 'La prise placée sera effacée : elle ne correspondrait plus à la photo recadrée. Il faudra la replacer.',
)

function backToCrop(): void {
  confirmingRecrop.value = false
  holds.value = []
  stage.value = 'crop'
}

function askBackToCrop(): void {
  // Les prises sont placées sur l'image recadrée : le dire avant, pas après.
  if (holds.value.length > 0) confirmingRecrop.value = true
  else backToCrop()
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="new-route-photo">
    <RoutePhotoPicker
      v-model="picked"
      label="Photo de la voie (optionnelle)"
      hint="Vous pourrez la recadrer, puis y placer les prises : leur nombre remplacera « Nombre de prises »."
      @crop-applied="stage = 'annotate'"
    >
      <template #preview="{ url }">
        <template v-if="stage === 'annotate'">
          <HoldAnnotator
            v-model="holds"
            :image-url="url"
            :route-number="props.routeNumber"
            :hold-count="null"
          />
          <div>
            <Button variant="secondary" @click="annotating = true">Agrandir la photo</Button>
          </div>
          <HoldAnnotatorDialog
            v-model="holds"
            :open="annotating"
            :image-url="url"
            :route-number="props.routeNumber"
            :hold-count="null"
            @close="annotating = false"
          />
        </template>
        <img
          v-else
          :src="url"
          alt="Aperçu de la photo"
          class="max-h-96 max-w-full self-start rounded-lg border border-gray-300 bg-white"
          data-testid="photo-preview"
        />
      </template>

      <template #actions="{ crop, ready, openCrop, clearCrop }">
        <div
          v-if="stage === 'crop'"
          class="flex flex-col gap-3 rounded-lg bg-blue-50 p-3"
          data-testid="crop-step"
        >
          <p class="text-sm font-medium text-gray-900">
            Souhaitez-vous recadrer la photo ? Gardez seulement la voie, puis passez au placement
            des prises.
          </p>
          <div class="flex flex-wrap gap-3">
            <Button variant="secondary" :disabled="!ready" @click="openCrop">
              {{ crop ? 'Modifier le recadrage' : 'Recadrer la photo' }}
            </Button>
            <Button :disabled="!ready" @click="stage = 'annotate'">
              {{ crop ? 'Continuer avec ce recadrage' : 'Continuer sans recadrer' }}
            </Button>
            <Button v-if="crop" variant="secondary" @click="clearCrop">Retirer le recadrage</Button>
          </div>
        </div>
        <div v-else class="flex flex-wrap items-center gap-3" data-testid="annotate-step">
          <Button variant="secondary" @click="askBackToCrop">Modifier le recadrage</Button>
          <span v-if="crop" class="text-sm text-gray-700">La photo est recadrée.</span>
        </div>
      </template>
    </RoutePhotoPicker>

    <Modal
      :open="confirmingRecrop"
      title="Modifier le recadrage ?"
      @close="confirmingRecrop = false"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">{{ effaceMessage }}</p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingRecrop = false">Garder les prises</Button>
          <Button variant="danger" @click="backToCrop">Modifier le recadrage</Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
