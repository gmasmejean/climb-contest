<script setup lang="ts">
import { ORGANIZATION_PHOTO_MAX_COUNT, type OrganizationPhoto } from '@climbcontest/contracts'
import { Button, TextField } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref, useId, watch } from 'vue'

import { organizationPhotosApi } from '../api/organization'
import { useOrganizationPhotoUrls } from '../composables/useOrganizationPhotoUrls'
import { describeError, UNREACHABLE_MESSAGE } from '../lib/network-errors'
import {
  describeSkipped,
  movePhoto,
  PHOTO_CONSENT_WARNING,
  photoAlt,
  planUploads,
} from '../lib/organization-photos'
import { PhotoUnreadableError, resizeToJpeg } from '../lib/photo-resize'

/**
 * Photos de la fiche, pour un owner (Lot 27, ADR-090). Chaque action est
 * enregistrée tout de suite, hors du bouton « Enregistrer la fiche ». La
 * suppression est logique : un bandeau « Annuler » reste affiché jusqu'à
 * l'action suivante, sans délai qui le ferait disparaître.
 */

const props = defineProps<{ organizationName: string }>()

const QUERY_KEY = ['organization', 'photos']
const queryClient = useQueryClient()
const inputId = useId()

const { data, isPending, isError, refetch } = useQuery({
  queryKey: QUERY_KEY,
  queryFn: organizationPhotosApi.list,
})

const photos = computed<OrganizationPhoto[]>(() => data.value ?? [])
const ids = computed(() => photos.value.map((photo) => photo.id))
const { src } = useOrganizationPhotoUrls(ids)
const full = computed(() => photos.value.length >= ORGANIZATION_PHOTO_MAX_COUNT)

const busy = ref(false)
const progress = ref('')
const error = ref('')
const notice = ref('')
const lastDeleted = ref<string | null>(null)
// Texte alternatif en cours de saisie, par photo : un rechargement de la liste
// n'efface pas ce qui est tapé.
const drafts = reactive(new Map<string, string>())

watch(
  photos,
  (list) => {
    for (const photo of list) if (!drafts.has(photo.id)) drafts.set(photo.id, photo.altText ?? '')
  },
  { immediate: true },
)

function setPhotos(next: OrganizationPhoto[]): void {
  queryClient.setQueryData(QUERY_KEY, next)
}

/** Chaque action repart d'un écran propre : l'« Annuler » précédent n'a plus cours. */
function startAction(): void {
  error.value = ''
  notice.value = ''
  lastDeleted.value = null
}

async function run(action: () => Promise<void>): Promise<void> {
  busy.value = true
  try {
    await action()
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
    progress.value = ''
  }
}

async function onFiles(event: Event): Promise<void> {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files) return
  const chosen = [...input.files]
  // Vider le champ : choisir de nouveau la même photo doit déclencher l'envoi.
  input.value = ''
  startAction()
  const { accepted, skipped } = planUploads(chosen, photos.value.length)
  const problems: string[] = []
  await run(async () => {
    for (const [index, file] of accepted.entries()) {
      progress.value =
        accepted.length > 1
          ? `Envoi de la photo ${index + 1} sur ${accepted.length}…`
          : 'Envoi de la photo…'
      try {
        const jpeg = await resizeToJpeg(file)
        const photo = await organizationPhotosApi.upload(jpeg)
        setPhotos([...photos.value, photo])
      } catch (caught) {
        const reason =
          caught instanceof PhotoUnreadableError ? caught.message : describeError(caught)
        problems.push(`${file.name} : ${reason}`)
        if (!(caught instanceof PhotoUnreadableError)) break
      }
    }
  })
  error.value = problems.join(' ')
  notice.value = describeSkipped(skipped)
}

async function saveAlt(photo: OrganizationPhoto): Promise<void> {
  startAction()
  const text = (drafts.get(photo.id) ?? '').trim()
  await run(async () => {
    const saved = await organizationPhotosApi.update(photo.id, {
      altText: text === '' ? null : text,
    })
    drafts.set(photo.id, saved.altText ?? '')
    setPhotos(photos.value.map((p) => (p.id === saved.id ? saved : p)))
    notice.value = 'Description enregistrée.'
  })
}

function altChanged(photo: OrganizationPhoto): boolean {
  return (drafts.get(photo.id) ?? '').trim() !== (photo.altText ?? '')
}

async function move(photo: OrganizationPhoto, delta: -1 | 1): Promise<void> {
  const next = movePhoto(ids.value, photo.id, delta)
  if (!next) return
  startAction()
  await run(async () => {
    setPhotos(await organizationPhotosApi.reorder(next))
  })
  if (error.value) void refetch()
}

async function remove(photo: OrganizationPhoto): Promise<void> {
  startAction()
  await run(async () => {
    await organizationPhotosApi.remove(photo.id)
    setPhotos(photos.value.filter((p) => p.id !== photo.id))
    lastDeleted.value = photo.id
  })
}

async function undo(): Promise<void> {
  const id = lastDeleted.value
  if (id === null) return
  startAction()
  await run(async () => {
    await organizationPhotosApi.restore(id)
    // L'ordre vient du serveur : la photo revient à sa place.
    await refetch()
    notice.value = 'Photo remise.'
  })
}

const addLabelClass =
  'inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full bg-blue-800 px-5 py-3 text-base font-semibold text-white hover:bg-blue-700 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-700'
</script>

<template>
  <section aria-labelledby="photos-title" class="flex flex-col gap-4" data-testid="photos-manager">
    <div class="flex flex-col gap-2">
      <h2 id="photos-title" class="text-ink text-xl font-bold">Photos</h2>
      <p class="text-gray-700">
        Jusqu’à {{ ORGANIZATION_PHOTO_MAX_COUNT }} photos, affichées dans l’encart public. Elles
        sont enregistrées dès l’envoi, sans passer par « Enregistrer la fiche ».
      </p>
      <p class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
        {{ PHOTO_CONSENT_WARNING }}
      </p>
    </div>

    <p v-if="isPending" class="text-gray-600">Chargement des photos…</p>
    <div v-else-if="isError && !data" role="alert" class="flex flex-col items-start gap-3">
      <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
      <Button variant="secondary" @click="() => refetch()">Réessayer</Button>
    </div>

    <template v-else>
      <div
        v-if="lastDeleted"
        role="status"
        class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white p-3"
        data-testid="photo-deleted"
      >
        <span class="text-gray-900">Photo supprimée.</span>
        <Button variant="secondary" :disabled="busy" @click="undo">Annuler</Button>
      </div>

      <ol v-if="photos.length > 0" class="flex flex-col gap-4">
        <li
          v-for="(photo, index) in photos"
          :key="photo.id"
          class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3"
          data-testid="managed-photo"
        >
          <div class="flex items-start gap-3">
            <div class="aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-md bg-gray-100">
              <img
                v-if="src(photo.id)"
                :src="src(photo.id) ?? undefined"
                :alt="photoAlt(photo, index, photos.length, props.organizationName)"
                class="size-full object-cover"
              />
            </div>
            <p class="text-sm text-gray-700">Photo {{ index + 1 }} sur {{ photos.length }}</p>
          </div>
          <TextField
            :model-value="drafts.get(photo.id) ?? ''"
            label="Description (texte alternatif)"
            hint="Lue à voix haute aux personnes aveugles, par exemple « Le mur de bloc ». Facultative."
            @update:model-value="drafts.set(photo.id, $event)"
          />
          <div class="flex flex-wrap gap-2">
            <Button
              v-if="altChanged(photo)"
              variant="secondary"
              :disabled="busy"
              @click="saveAlt(photo)"
            >
              Enregistrer la description
            </Button>
            <Button
              variant="secondary"
              :disabled="busy || index === 0"
              :aria-label="`Avancer la photo ${index + 1}`"
              @click="move(photo, -1)"
            >
              ↑ Avancer
            </Button>
            <Button
              variant="secondary"
              :disabled="busy || index === photos.length - 1"
              :aria-label="`Reculer la photo ${index + 1}`"
              @click="move(photo, 1)"
            >
              ↓ Reculer
            </Button>
            <Button
              variant="danger"
              :disabled="busy"
              :aria-label="`Supprimer la photo ${index + 1}`"
              @click="remove(photo)"
            >
              Supprimer
            </Button>
          </div>
        </li>
      </ol>
      <p v-else class="text-gray-700">Aucune photo pour l’instant.</p>

      <div class="flex flex-col items-start gap-2">
        <p v-if="full" class="text-gray-700">
          La fiche a {{ ORGANIZATION_PHOTO_MAX_COUNT }} photos : supprimez-en une pour en ajouter.
        </p>
        <label v-else :for="inputId" :class="addLabelClass">
          {{ busy && progress ? progress : 'Ajouter des photos' }}
          <input
            :id="inputId"
            type="file"
            accept="image/*"
            multiple
            class="sr-only"
            :disabled="busy"
            data-testid="photo-input"
            @change="onFiles"
          />
        </label>
        <p v-if="progress" role="status" class="sr-only">{{ progress }}</p>
      </div>

      <p v-if="error" role="alert" class="text-red-700">{{ error }}</p>
      <p v-else-if="notice" role="status" class="text-gray-800">{{ notice }}</p>
    </template>
  </section>
</template>
