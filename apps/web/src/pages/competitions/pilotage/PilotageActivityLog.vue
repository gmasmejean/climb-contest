<script setup lang="ts">
import { Button, Select, useToast } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { dashboardApi } from '../../../api/dashboard'

const props = defineProps<{ competitionId: string }>()
const toast = useToast()

const TYPE_LABELS: Record<string, string> = {
  round_status_changed: 'Statut du tour',
  competitor_status_changed: 'Statut du compétiteur',
  ascent_created: 'Passage saisi',
  ascent_corrected: 'Passage corrigé',
  ascent_voided: 'Passage annulé',
  conflict_resolved: 'Conflit résolu',
}
const typeFilter = ref('')
const actorTypeFilter = ref('')
const typeOptions = [
  { value: '', label: 'Tous les types' },
  ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
]
const actorTypeOptions = [
  { value: '', label: 'Tous les acteurs' },
  { value: 'judge', label: 'Juge' },
  { value: 'organizer', label: 'Organisateur' },
  { value: 'system', label: 'Système' },
]

const filters = computed(() => ({
  ...(typeFilter.value ? { type: typeFilter.value } : {}),
  ...(actorTypeFilter.value ? { actorType: actorTypeFilter.value } : {}),
}))

const { data, isPending } = useQuery({
  queryKey: ['competitions', props.competitionId, 'activity-log', filters],
  queryFn: () => dashboardApi.activityLog(props.competitionId, filters.value),
})

const isDownloading = ref(false)
async function downloadCsv(): Promise<void> {
  isDownloading.value = true
  try {
    const blob = await dashboardApi.downloadActivityLogCsv(props.competitionId, filters.value)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `journal-activite-${props.competitionId}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.show('Impossible de générer le journal.', 'error')
  } finally {
    isDownloading.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Select v-model="typeFilter" label="Type" :options="typeOptions" />
      <Select v-model="actorTypeFilter" label="Acteur" :options="actorTypeOptions" />
    </div>
    <Button variant="secondary" :disabled="isDownloading" @click="downloadCsv">
      {{ isDownloading ? 'Génération…' : 'Exporter en CSV' }}
    </Button>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="entry in data?.entries ?? []"
        :key="entry.id"
        class="flex flex-col gap-1 rounded-lg border border-gray-200 px-4 py-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-medium text-gray-900">{{ TYPE_LABELS[entry.type] ?? entry.type }}</span>
          <span class="text-xs text-gray-500">{{ new Date(entry.createdAt).toLocaleString('fr-FR') }}</span>
        </div>
        <p class="text-sm text-gray-600">
          {{ entry.actorLabel ?? entry.actorType }}
          <span v-if="entry.reason"> — {{ entry.reason }}</span>
        </p>
      </li>
      <li v-if="data && data.entries.length === 0" class="text-gray-600">Aucune activité.</li>
    </ul>
  </div>
</template>
