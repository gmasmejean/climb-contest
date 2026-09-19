<script setup lang="ts">
import type { BackupPreview } from '@climbcontest/contracts'
import { Button, FileInput, Modal, useToast } from '@climbcontest/ui'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '../../api/client'
import { exportsApi } from '../../api/competitions'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const toast = useToast()

const file = ref<File | null>(null)
const backup = ref<unknown>(null)
const preview = ref<BackupPreview | null>(null)
const error = ref('')
const busy = ref(false)

function reset(): void {
  file.value = null
  backup.value = null
  preview.value = null
  error.value = ''
}

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) reset()
  },
)

// L'aperçu est OBLIGATOIRE avant d'écrire quoi que ce soit (comme l'import CSV
// des compétiteurs) : choisir un fichier ne crée rien.
watch(file, async (chosen) => {
  preview.value = null
  backup.value = null
  error.value = ''
  if (!chosen) return

  busy.value = true
  try {
    try {
      backup.value = JSON.parse(await chosen.text())
    } catch {
      error.value = 'Ce fichier n’est pas une sauvegarde : il ne contient pas de JSON valide.'
      return
    }
    preview.value = await exportsApi.previewImport(backup.value)
  } catch (caught) {
    error.value =
      caught instanceof ApiError
        ? (caught.detail ?? caught.title)
        : 'Impossible de vérifier ce fichier. Vérifiez votre connexion et réessayez.'
  } finally {
    busy.value = false
  }
})

async function confirmImport(): Promise<void> {
  if (!backup.value) return
  busy.value = true
  try {
    const { competitionId } = await exportsApi.commitImport(backup.value)
    toast.show('Compétition importée.', 'success')
    emit('close')
    await router.push({ name: 'competition-detail', params: { id: competitionId } })
  } catch (caught) {
    error.value =
      caught instanceof ApiError
        ? (caught.detail ?? caught.title)
        : 'L’import a échoué et rien n’a été créé. Réessayez.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="Importer une sauvegarde" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p class="text-sm text-gray-700">
        Choisissez un fichier de sauvegarde (.json). Rien n’est créé avant votre confirmation.
      </p>
      <FileInput v-model="file" label="Fichier de sauvegarde" accept=".json,application/json" />

      <p v-if="busy && !preview" class="text-sm text-gray-600">Vérification du fichier…</p>
      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>

      <div v-if="preview" class="flex flex-col gap-3 rounded-lg border border-gray-200 p-4">
        <p class="font-medium text-gray-900">{{ preview.competitionName }}</p>
        <ul class="text-sm text-gray-800">
          <li>{{ preview.counts.categories }} catégorie(s)</li>
          <li>{{ preview.counts.competitors }} compétiteur(s)</li>
          <li>{{ preview.counts.routes }} voie(s), {{ preview.counts.rounds }} tour(s)</li>
          <li>{{ preview.counts.judges }} juge(s), {{ preview.counts.ascents }} passage(s)</li>
        </ul>
        <ul class="list-disc pl-5 text-sm text-gray-700">
          <li v-for="notice in preview.notices" :key="notice">{{ notice }}</li>
        </ul>
      </div>

      <div class="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" @click="emit('close')">Annuler</Button>
        <Button :disabled="!preview || busy" @click="confirmImport">
          {{ busy && preview ? 'Import…' : 'Créer la compétition' }}
        </Button>
      </div>
    </div>
  </Modal>
</template>
