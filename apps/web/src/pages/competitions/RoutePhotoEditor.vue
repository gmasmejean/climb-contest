<script setup lang="ts">
import type { RouteHold } from '@climbcontest/contracts'
import { Button, Modal, useToast } from '@climbcontest/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { ApiError } from '../../api/client'
import { routePhotoApi } from '../../api/competitions'
import HoldAnnotator from '../../components/HoldAnnotator.vue'
import { numberingGap } from '../../lib/hold-numbering'
import type { PickedPhoto } from '../../lib/photo-crop'
import { PhotoUnreadableError, resizeToJpeg } from '../../lib/photo-resize'
import RoutePhotoPicker from './RoutePhotoPicker.vue'

/**
 * Photo annotée d'une voie (Lot 15, ADR-066) : téléversement (ré-encodé en JPEG
 * dans le navigateur) puis placement des prises. Toucher la photo pose une prise,
 * toucher une prise la sélectionne, la glisser la déplace. Les modifications
 * restent locales jusqu'à « Enregistrer les prises » : « Annuler les
 * modifications » revient à ce que le serveur a.
 */
const props = defineProps<{
  competitionId: string
  routeId: string
  routeNumber: number
  /** Nombre de prises ENREGISTRÉ de la voie : le pavé du juge s'y arrête. */
  holdCount: number
  photoAssetId: string | null
  savedHolds: RouteHold[]
}>()
const emit = defineEmits<{ changed: []; 'use-hold-count': [count: number] }>()

const toast = useToast()

const holds = ref<RouteHold[]>([])
const error = ref('')

const byNumber = (list: readonly RouteHold[]) => [...list].sort((a, b) => a.number - b.number)
const serialize = (list: readonly RouteHold[]) => JSON.stringify(byNumber(list))

function loadSaved(): void {
  holds.value = byNumber(props.savedHolds).map((hold) => ({ ...hold }))
}
// Une CLÉ texte, pas un tableau : un tableau neuf déclencherait la remise à zéro
// à chaque relecture des voies (retour sur l'onglet…), et effacerait les
// modifications en cours alors que rien n'a changé côté serveur.
watch(() => `${props.photoAssetId ?? ''}|${serialize(props.savedHolds)}`, loadSaved, {
  immediate: true,
})

const dirty = computed(() => serialize(holds.value) !== serialize(props.savedHolds))
const isContiguous = computed(() => holds.value.length > 0 && numberingGap(holds.value) === null)

// --- Aperçu de la photo (le jeton passe en en-tête : un <img src> ne le pourrait pas).
const imageUrl = ref<string | null>(null)
const imageError = ref(false)
let loadToken = 0

function releaseImage(): void {
  if (imageUrl.value !== null) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = null
}

async function loadImage(): Promise<void> {
  const token = (loadToken += 1)
  releaseImage()
  imageError.value = false
  if (!props.photoAssetId) return
  try {
    const blob = await routePhotoApi.fetchImage(props.competitionId, props.routeId)
    if (token !== loadToken) return
    imageUrl.value = URL.createObjectURL(blob)
  } catch {
    if (token === loadToken) imageError.value = true
  }
}
watch(() => props.photoAssetId, loadImage, { immediate: true })
onBeforeUnmount(() => {
  loadToken += 1
  releaseImage()
})

function messageOf(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) return caught.detail ?? caught.title
  if (caught instanceof PhotoUnreadableError) return caught.message
  return fallback
}

// --- Envoi, remplacement, suppression de la photo.
const picked = ref<PickedPhoto | null>(null)
const sending = ref(false)
const confirmingReplace = ref(false)
const confirmingDelete = ref(false)

async function send(): Promise<void> {
  const chosen = picked.value
  if (!chosen) return
  confirmingReplace.value = false
  error.value = ''
  sending.value = true
  try {
    const jpeg = await resizeToJpeg(chosen.file, { crop: chosen.crop })
    await routePhotoApi.upload(props.competitionId, props.routeId, jpeg)
    picked.value = null
    toast.show('Photo enregistrée.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(
      caught,
      'L’envoi de la photo a échoué. Vérifiez le réseau et réessayez.',
    )
  } finally {
    sending.value = false
  }
}

function askSend(): void {
  // Remplacer la photo efface les prises : on le dit avant, pas après.
  if (props.photoAssetId && props.savedHolds.length > 0) confirmingReplace.value = true
  else void send()
}

async function removePhoto(): Promise<void> {
  confirmingDelete.value = false
  error.value = ''
  try {
    await routePhotoApi.remove(props.competitionId, props.routeId)
    toast.show('Photo supprimée.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible de supprimer la photo. Réessayez.')
  }
}

// --- Enregistrement de l'annotation.
const saving = ref(false)

async function saveHolds(): Promise<void> {
  error.value = ''
  saving.value = true
  try {
    await routePhotoApi.saveHolds(props.competitionId, props.routeId, byNumber(holds.value))
    toast.show('Prises enregistrées.', 'success')
    emit('changed')
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible d’enregistrer les prises. Réessayez.')
  } finally {
    saving.value = false
  }
}

const printing = ref(false)
async function printSheet(): Promise<void> {
  error.value = ''
  printing.value = true
  try {
    await routePhotoApi.downloadSheets(props.competitionId, props.routeId)
  } catch (caught) {
    error.value = messageOf(caught, 'Impossible de générer la fiche. Réessayez.')
  } finally {
    printing.value = false
  }
}
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4"
    aria-label="Photo annotée de la voie"
    data-testid="route-photo-editor"
  >
    <h3 class="text-sm font-semibold text-gray-900">Photo annotée de la voie</h3>

    <template v-if="props.photoAssetId">
      <HoldAnnotator
        v-model="holds"
        :image-url="imageUrl"
        :image-error="imageError"
        :route-number="props.routeNumber"
        :hold-count="props.holdCount"
      />
      <div v-if="dirty">
        <Button variant="secondary" @click="loadSaved">Annuler les modifications</Button>
      </div>

      <div
        v-if="holds.length > 0 && holds.length !== props.holdCount && isContiguous && !dirty"
        class="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3"
      >
        <p class="text-sm text-amber-900">
          Vous avez placé {{ holds.length }} prises alors que la voie en compte
          {{ props.holdCount }}.
        </p>
        <div>
          <Button variant="secondary" @click="emit('use-hold-count', holds.length)">
            Utiliser {{ holds.length }} comme nombre de prises
          </Button>
        </div>
        <p class="text-sm text-amber-900">
          Le nombre est reporté dans le champ ci-dessus : il ne change qu'après « Enregistrer ».
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <Button :disabled="!dirty || saving" @click="saveHolds">
          {{ saving ? 'Enregistrement…' : 'Enregistrer les prises' }}
        </Button>
      </div>
      <p v-if="dirty" class="text-sm text-amber-800" role="status">
        Modifications non enregistrées.
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <Button variant="secondary" :disabled="dirty || printing" @click="printSheet">
          {{ printing ? 'Génération…' : 'Imprimer la fiche de cette voie' }}
        </Button>
        <span v-if="dirty" class="text-sm text-gray-600">Enregistrez d'abord les prises.</span>
      </div>
    </template>
    <p v-else class="text-sm text-gray-700">
      Aucune photo. Ajoutez celle que les juges reçoivent d'habitude, puis placez-y les prises : le
      juge pourra l'afficher depuis son téléphone, même sans réseau.
    </p>

    <RoutePhotoPicker
      v-model="picked"
      :label="props.photoAssetId ? 'Remplacer la photo' : 'Choisir une photo'"
      hint="La voie en entier, prise de face. Vous pourrez la recadrer. La photo est réduite avant l'envoi."
    />
    <p v-if="props.photoAssetId && props.savedHolds.length > 0" class="text-sm text-amber-800">
      Remplacer la photo efface les prises déjà placées.
    </p>

    <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>

    <div class="flex flex-wrap gap-3">
      <Button :disabled="!picked || sending" @click="askSend">
        {{
          sending
            ? 'Envoi en cours…'
            : props.photoAssetId
              ? 'Envoyer la nouvelle photo'
              : 'Envoyer la photo'
        }}
      </Button>
      <Button v-if="props.photoAssetId" variant="secondary" @click="confirmingDelete = true">
        Supprimer la photo
      </Button>
    </div>

    <Modal
      :open="confirmingReplace"
      title="Remplacer la photo ?"
      @close="confirmingReplace = false"
    >
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">
          Les {{ props.savedHolds.length }} prises placées sur l'ancienne photo seront effacées :
          elles ne correspondraient pas à la nouvelle. Il faudra les replacer.
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingReplace = false">Garder l'ancienne</Button>
          <Button @click="send">Remplacer la photo</Button>
        </div>
      </div>
    </Modal>

    <Modal :open="confirmingDelete" title="Supprimer la photo ?" @close="confirmingDelete = false">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">
          La photo et les prises placées dessus seront supprimées. Les juges ne la verront plus.
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingDelete = false">Garder la photo</Button>
          <Button variant="danger" @click="removePhoto">Supprimer la photo</Button>
        </div>
      </div>
    </Modal>
  </section>
</template>
