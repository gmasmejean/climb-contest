<script setup lang="ts">
import { Button, Select, useToast } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, exportsApi } from '../../../api/competitions'

const props = defineProps<{ competitionId: string }>()

const toast = useToast()
const busy = ref<string | null>(null)
const categoryId = ref('')

const { data: categories } = useQuery({
  queryKey: ['competitions', props.competitionId, 'categories'],
  queryFn: () => categoriesApi.list(props.competitionId),
})

const categoryOptions = computed(() => [
  { value: '', label: 'Toutes les catégories' },
  ...(categories.value ?? []).map((cat) => ({ value: cat.id, label: cat.label })),
])

async function download(file: 'results.pdf' | 'results.csv' | 'competition.json'): Promise<void> {
  busy.value = file
  try {
    await exportsApi.download(props.competitionId, file, categoryId.value || undefined)
    toast.show('Fichier téléchargé.', 'success')
  } catch (error) {
    toast.show(
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Le téléchargement a échoué. Vérifiez votre connexion et réessayez.',
      'error',
    )
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <section class="flex flex-col gap-4">
      <h2 class="text-lg font-semibold text-gray-900">Résultats</h2>
      <p class="text-sm text-gray-700">
        Le classement tel que le public le voit : nom, prénom, club et dossard. Tant qu’un tour
        n’est pas publié, les résultats sont marqués « provisoire ».
      </p>
      <Select v-model="categoryId" label="Catégorie" :options="categoryOptions" />
      <div class="flex flex-wrap gap-3">
        <Button :disabled="busy !== null" @click="download('results.pdf')">
          {{ busy === 'results.pdf' ? 'Préparation…' : 'Résultats en PDF' }}
        </Button>
        <Button variant="secondary" :disabled="busy !== null" @click="download('results.csv')">
          {{ busy === 'results.csv' ? 'Préparation…' : 'Résultats en CSV (tableur)' }}
        </Button>
      </div>
    </section>

    <section class="flex flex-col gap-4 border-t border-gray-200 pt-6">
      <h2 class="text-lg font-semibold text-gray-900">Sauvegarde complète</h2>
      <p class="text-sm text-gray-700">
        Toute la compétition (catégories, compétiteurs, voies, tours, passages et historique) dans
        un seul fichier, à garder au chaud. Vous pourrez la réimporter depuis « Mes compétitions ».
        Elle contient les données personnelles des compétiteurs : rangez-la avec soin. Les accès des
        juges n’y figurent pas, ni les vidéos téléversées.
      </p>
      <div>
        <Button variant="secondary" :disabled="busy !== null" @click="download('competition.json')">
          {{ busy === 'competition.json' ? 'Préparation…' : 'Télécharger la sauvegarde' }}
        </Button>
      </div>
    </section>
  </div>
</template>
