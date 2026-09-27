<script setup lang="ts">
import { retentionStatus, type Competition } from '@climbcontest/contracts'
import { Badge, Button, Modal, Select, TextField, useToast } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, exportsApi } from '../../../api/competitions'
import { currentUser } from '../../../api/session'

const props = defineProps<{ competition: Competition }>()
const competitionId = computed(() => props.competition.id)
const queryClient = useQueryClient()

const isOwner = computed(() => currentUser.value?.role === 'owner')
const retention = computed(() =>
  retentionStatus(props.competition.endsOn, new Date().toISOString().slice(0, 10)),
)
const purgedOn = computed(() =>
  props.competition.purgedAt ? new Date(props.competition.purgedAt).toLocaleDateString('fr-FR') : null,
)

const purgeOpen = ref(false)
const confirmName = ref('')
const purgeError = ref('')
const purging = ref(false)

const toast = useToast()
const busy = ref<string | null>(null)
const categoryId = ref('')

const { data: categories } = useQuery({
  queryKey: ['competitions', props.competition.id, 'categories'],
  queryFn: () => categoriesApi.list(props.competition.id),
})

const categoryOptions = computed(() => [
  { value: '', label: 'Toutes les catégories' },
  ...(categories.value ?? []).map((cat) => ({ value: cat.id, label: cat.label })),
])

async function download(file: 'results.pdf' | 'results.csv' | 'competition.json'): Promise<void> {
  busy.value = file
  try {
    await exportsApi.download(competitionId.value, file, categoryId.value || undefined)
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

async function downloadPersonalData(): Promise<void> {
  busy.value = 'gdpr'
  try {
    await exportsApi.downloadPersonalData(competitionId.value)
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

function openPurge(): void {
  confirmName.value = ''
  purgeError.value = ''
  purgeOpen.value = true
}

async function purge(): Promise<void> {
  purging.value = true
  purgeError.value = ''
  try {
    await exportsApi.purgePersonalData(competitionId.value, confirmName.value)
    purgeOpen.value = false
    toast.show('Données personnelles supprimées.', 'success')
    await queryClient.invalidateQueries({ queryKey: ['competitions'] })
  } catch (error) {
    purgeError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'La suppression a échoué et rien n’a été supprimé. Vérifiez votre connexion et réessayez.'
  } finally {
    purging.value = false
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

    <section class="flex flex-col gap-4 border-t border-gray-200 pt-6" aria-label="Données personnelles">
      <h2 class="text-lg font-semibold text-gray-900">Données personnelles (RGPD)</h2>

      <p v-if="purgedOn" class="text-sm text-gray-800">
        <Badge tone="neutral">Purgée</Badge>
        Les données personnelles de cette compétition ont été supprimées le {{ purgedOn }}. Les
        résultats restent, sans aucun nom.
      </p>

      <template v-else>
        <p
          v-if="retention !== 'ok'"
          role="status"
          class="rounded-lg border px-4 py-3 text-sm"
          :class="
            retention === 'purge_due'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          "
        >
          <template v-if="retention === 'purge_due'">
            Cette compétition date de plus de 5 ans : exportez ce qu’il faut garder, puis supprimez
            les données personnelles.
          </template>
          <template v-else>
            Cette compétition date de plus de 2 ans : pensez à exporter ses données, puis à les
            supprimer avant 5 ans.
          </template>
        </p>

        <p class="text-sm text-gray-700">
          Les compétiteurs sont souvent mineurs. Exportez ce que l’application sait d’eux, ou
          supprimez leurs données : noms, années de naissance, clubs, licences, vidéos et motifs
          saisis. Les résultats restent, sans personne derrière. Aucune suppression n’est jamais
          automatique.
        </p>

        <p v-if="!isOwner" class="text-sm text-gray-700">
          Ces deux actions sont réservées au propriétaire de l’organisation.
        </p>
        <div v-else class="flex flex-wrap gap-3">
          <Button variant="secondary" :disabled="busy !== null" @click="downloadPersonalData">
            {{ busy === 'gdpr' ? 'Préparation…' : 'Exporter les données personnelles' }}
          </Button>
          <Button variant="secondary" :disabled="busy !== null" @click="openPurge">
            Supprimer les données personnelles…
          </Button>
        </div>
      </template>
    </section>

    <Modal :open="purgeOpen" title="Supprimer les données personnelles ?" @close="purgeOpen = false">
      <form class="flex flex-col gap-4" @submit.prevent="purge">
        <p class="text-sm text-gray-800">
          Cette action est <strong>définitive</strong>. Les noms, années de naissance, clubs,
          licences, vidéos et motifs de cette compétition seront supprimés, et son lien public
          cessera de fonctionner. Faites d’abord une sauvegarde et un export si vous en avez
          besoin.
        </p>
        <TextField
          v-model="confirmName"
          :label="`Pour confirmer, retapez : ${competition.name}`"
          autocomplete="off"
        />
        <p v-if="purgeError" role="alert" class="text-sm text-red-700">{{ purgeError }}</p>
        <div class="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" @click="purgeOpen = false">Annuler</Button>
          <Button type="submit" :disabled="confirmName !== competition.name || purging">
            {{ purging ? 'Suppression…' : 'Supprimer définitivement' }}
          </Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
