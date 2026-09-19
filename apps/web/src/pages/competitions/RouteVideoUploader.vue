<script setup lang="ts">
import { Button, FileInput, Modal, useToast } from '@climbcontest/ui'
import { onBeforeUnmount, ref } from 'vue'

import { apiRawFetch, errorFromResponse } from '../../api/client'
import {
  UploadInterruptedError,
  UploadRefusedError,
  abandonUpload,
  abortableSleep,
  localStorageUploadStore,
  uploadVideo,
  type UploadParams,
} from '../../lib/video-upload'

const props = defineProps<{ competitionId: string; routeId: string; hasVideo: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const toast = useToast()
const store = localStorageUploadStore()

const file = ref<File | null>(null)
const sent = ref(0)
const total = ref(0)
const uploading = ref(false)
const error = ref('')
const confirmingDelete = ref(false)
let controller: AbortController | null = null

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

/** Certains systèmes ne renseignent pas `file.type` pour un .mov ou un .webm : on le déduit de l'extension. */
function guessMimeType(chosen: File): string | null {
  if (chosen.type.startsWith('video/')) return chosen.type
  const extension = chosen.name.split('.').at(-1)?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? null
}

const percent = () => (total.value === 0 ? 0 : Math.round((sent.value / total.value) * 100))
const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')

function adapt(chosen: File, type: string): UploadParams['file'] {
  return {
    name: chosen.name,
    size: chosen.size,
    type,
    lastModified: chosen.lastModified,
    slice: (start, end) => chosen.slice(start, end),
  }
}

async function send(): Promise<void> {
  const chosen = file.value
  if (!chosen) return
  const type = guessMimeType(chosen)
  if (!type) {
    error.value = 'Format non accepté. Choisissez une vidéo MP4, MOV (QuickTime) ou WebM.'
    return
  }

  error.value = ''
  uploading.value = true
  sent.value = 0
  total.value = chosen.size
  controller = new AbortController()
  try {
    await uploadVideo(
      { request: apiRawFetch, store, sleep: abortableSleep },
      {
        file: adapt(chosen, type),
        competitionId: props.competitionId,
        routeId: props.routeId,
        signal: controller.signal,
        onProgress: (done, all) => {
          sent.value = done
          total.value = all
        },
      },
    )
    toast.show('Vidéo enregistrée.', 'success')
    file.value = null
    emit('changed')
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') {
      error.value = ''
    } else if (caught instanceof UploadRefusedError || caught instanceof UploadInterruptedError) {
      error.value = caught.message
    } else {
      error.value = 'L’envoi a échoué. Vos octets déjà envoyés sont conservés : réessayez.'
    }
  } finally {
    uploading.value = false
    controller = null
  }
}

async function cancel(): Promise<void> {
  const chosen = file.value
  controller?.abort()
  if (chosen) {
    await abandonUpload(apiRawFetch, store, {
      file: adapt(chosen, guessMimeType(chosen) ?? chosen.type),
      competitionId: props.competitionId,
      routeId: props.routeId,
    })
  }
  file.value = null
  sent.value = 0
}

async function removeVideo(): Promise<void> {
  confirmingDelete.value = false
  const response = await apiRawFetch(
    `/competitions/${props.competitionId}/routes/${props.routeId}/video`,
    { method: 'DELETE' },
  ).catch(() => null)
  if (!response || !response.ok) {
    const problem = response ? await errorFromResponse(response) : null
    toast.show(problem?.detail ?? 'Impossible de supprimer la vidéo. Réessayez.', 'error')
    return
  }
  toast.show('Vidéo supprimée.', 'success')
  emit('changed')
}

// Quitter l'écran pendant un envoi l'interrompt SANS le perdre : l'identifiant
// reste en mémoire locale, re-choisir le même fichier reprend.
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
    <h3 class="text-sm font-semibold text-gray-900">Vidéo téléversée</h3>

    <p v-if="hasVideo" class="flex flex-wrap items-center gap-3 text-sm text-gray-800">
      <span>Une vidéo est enregistrée pour cette voie.</span>
      <Button variant="secondary" :disabled="uploading" @click="confirmingDelete = true">
        Supprimer la vidéo
      </Button>
    </p>
    <p v-else class="text-sm text-gray-700">
      Aucune vidéo téléversée. Vous pouvez aussi mettre un lien YouTube ou Vimeo ci-dessus.
    </p>

    <FileInput
      v-model="file"
      :label="hasVideo ? 'Remplacer la vidéo' : 'Choisir une vidéo'"
      accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm"
      hint="MP4, MOV ou WebM. Reprend tout seul après une coupure."
    />

    <div v-if="uploading" class="flex flex-col gap-2" aria-live="polite">
      <progress class="h-3 w-full" :value="sent" :max="total" aria-label="Progression de l’envoi" />
      <p class="text-sm text-gray-700">{{ percent() }} % — {{ megabytes(sent) }} sur {{ megabytes(total) }} Mo</p>
    </div>

    <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>

    <div class="flex flex-wrap gap-3">
      <Button :disabled="!file || uploading" @click="send">
        {{ uploading ? 'Envoi en cours…' : error ? 'Reprendre l’envoi' : 'Envoyer la vidéo' }}
      </Button>
      <Button v-if="file" variant="secondary" @click="cancel">Annuler</Button>
    </div>

    <Modal :open="confirmingDelete" title="Supprimer la vidéo ?" @close="confirmingDelete = false">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-800">
          La vidéo de cette voie sera supprimée pour de bon. Elle ne pourra pas être récupérée :
          il faudra la renvoyer.
        </p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="confirmingDelete = false">Garder la vidéo</Button>
          <Button @click="removeVideo">Supprimer la vidéo</Button>
        </div>
      </div>
    </Modal>
  </div>
</template>
