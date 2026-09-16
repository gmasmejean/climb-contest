<script setup lang="ts">
import type { ImportReport } from '@climbcontest/contracts'
import { Button, FileInput, useToast } from '@climbcontest/ui'
import { ref } from 'vue'

import { ApiError } from '../../api/client'
import { competitorsApi } from '../../api/competitions'

const props = defineProps<{ competitionId: string }>()
const emit = defineEmits<{ imported: [] }>()

const toast = useToast()

const step = ref<'select' | 'preview' | 'done'>('select')
const file = ref<File | null>(null)
const csv = ref('')
const report = ref<ImportReport | null>(null)
const loading = ref(false)
const error = ref('')

function reset(): void {
  step.value = 'select'
  file.value = null
  csv.value = ''
  report.value = null
  error.value = ''
}

function readFileAsText(target: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'))
    reader.readAsText(target, 'utf-8')
  })
}

async function onPreview(): Promise<void> {
  if (!file.value) return
  error.value = ''
  loading.value = true
  try {
    csv.value = await readFileAsText(file.value)
    report.value = await competitorsApi.importPreview(props.competitionId, csv.value)
    step.value = 'preview'
  } catch (err) {
    error.value =
      err instanceof ApiError ? (err.detail ?? err.title) : "Impossible d'analyser ce fichier."
  } finally {
    loading.value = false
  }
}

async function onCommit(): Promise<void> {
  error.value = ''
  loading.value = true
  try {
    report.value = await competitorsApi.importCommit(props.competitionId, csv.value)
    if (report.value.committed) {
      step.value = 'done'
      toast.show(`${report.value.totalRows} compétiteur(s) importé(s).`, 'success')
      emit('imported')
    }
  } catch (err) {
    error.value = err instanceof ApiError ? (err.detail ?? err.title) : "L'import a échoué."
  } finally {
    loading.value = false
  }
}

const canCommit = () =>
  report.value !== null &&
  report.value.totalRows > 0 &&
  report.value.validRows === report.value.totalRows
</script>

<template>
  <div class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4">
    <h2 class="font-medium text-gray-900">Import CSV</h2>
    <p class="text-sm text-gray-600">
      Colonnes attendues : <code>dossard</code> (optionnel), <code>prenom</code>, <code>nom</code>,
      <code>categorie</code>, <code>annee_naissance</code> (optionnel),
      <code>club</code> (optionnel), <code>licence</code> (optionnel). Rien n'est écrit tant que
      vous n'avez pas confirmé l'aperçu.
    </p>

    <template v-if="step === 'select'">
      <FileInput v-model="file" label="Fichier CSV" accept=".csv,text/csv" />
      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
      <Button :disabled="!file || loading" @click="onPreview">
        {{ loading ? 'Analyse…' : 'Prévisualiser' }}
      </Button>
    </template>

    <template v-else-if="step === 'preview' && report">
      <p class="text-sm text-gray-900">
        {{ report.validRows }} / {{ report.totalRows }} ligne(s) valide(s).
      </p>
      <div class="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
        <table class="w-full text-left text-sm">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-3 py-2">Ligne</th>
              <th class="px-3 py-2">Dossard</th>
              <th class="px-3 py-2">Nom</th>
              <th class="px-3 py-2">Catégorie</th>
              <th class="px-3 py-2">Erreurs</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in report.rows"
              :key="row.line"
              :class="row.errors.length > 0 ? 'bg-red-50' : ''"
            >
              <td class="px-3 py-2">{{ row.line }}</td>
              <td class="px-3 py-2">{{ row.bib ?? '—' }}</td>
              <td class="px-3 py-2">{{ row.firstName }} {{ row.lastName }}</td>
              <td class="px-3 py-2">{{ row.categoryLabel }}</td>
              <td class="px-3 py-2 text-red-700">{{ row.errors.join(' ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>
      <p v-if="!canCommit()" class="text-sm text-red-700">
        Corrigez les lignes en erreur dans votre fichier puis choisissez-le à nouveau — rien n'est
        importé tant que le fichier n'est pas entièrement valide.
      </p>

      <div class="flex gap-3">
        <Button variant="secondary" @click="reset">Choisir un autre fichier</Button>
        <Button :disabled="!canCommit() || loading" @click="onCommit">
          {{ loading ? 'Import…' : "Confirmer l'import" }}
        </Button>
      </div>
    </template>

    <template v-else-if="step === 'done' && report">
      <p class="text-sm font-medium text-green-800">
        {{ report.totalRows }} compétiteur(s) importé(s) avec succès.
      </p>
      <Button variant="secondary" @click="reset">Nouvel import</Button>
    </template>
  </div>
</template>
