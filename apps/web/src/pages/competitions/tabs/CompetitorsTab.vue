<script setup lang="ts">
import { createCompetitorInputSchema, type Competitor } from '@climbcontest/contracts'
import {
  Badge,
  Button,
  DataList,
  Modal,
  NumberField,
  Select,
  TextField,
  useToast,
  type DataListColumn,
  type DataListSort,
} from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { categoriesApi, competitorsApi } from '../../../api/competitions'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'
import { compareNumber, compareText, sortRows } from '../../../lib/table-sort'
import ListToolbar from '../../../components/ListToolbar.vue'
import CompetitorImportWizard from '../CompetitorImportWizard.vue'

const props = defineProps<{ competitionId: string }>()

const queryClient = useQueryClient()
const toast = useToast()
const competitorsKey = ['competitions', props.competitionId, 'competitors']
const categoriesKey = ['competitions', props.competitionId, 'categories']

const isDesktop = useMediaQuery(DESKTOP_QUERY)

const { data: competitors, isPending } = useQuery({
  queryKey: competitorsKey,
  queryFn: () => competitorsApi.list(props.competitionId),
})
const { data: categories } = useQuery({
  queryKey: categoriesKey,
  queryFn: () => categoriesApi.list(props.competitionId),
})

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: competitorsKey })
}

const categoryLabel = (categoryId: string) =>
  categories.value?.find((c) => c.id === categoryId)?.label ?? '—'
const categoryOptions = computed(
  () => categories.value?.map((c) => ({ value: c.id, label: c.label })) ?? [],
)

// --- Saisie rapide ---
const form = reactive({
  categoryId: '',
  bib: null as number | null,
  firstName: '',
  lastName: '',
  birthYear: null as number | null,
  clubName: '',
  licenseNumber: '',
})
const formError = ref('')
// Typé sur la forme exposée par TextField (`defineExpose`) plutôt que sur
// son type d'instance complet — plus robuste pour l'analyse de type d'ESLint
// sur les refs de composant `<script setup>`.
const firstNameInput = ref<{ focus: () => void } | null>(null)
/** Ligne d'ajout du tableau : un champ natif, pas un `TextField`. */
const quickFirstName = ref<HTMLInputElement | null>(null)

const { mutate: createCompetitor, isPending: isCreating } = useMutation({
  mutationFn: () =>
    competitorsApi.create(props.competitionId, {
      categoryId: form.categoryId,
      bib: form.bib,
      firstName: form.firstName,
      lastName: form.lastName,
      birthYear: form.birthYear,
      clubName: form.clubName.trim() || null,
      licenseNumber: form.licenseNumber.trim() || null,
    }),
  onSuccess: async () => {
    form.bib = null
    form.firstName = ''
    form.lastName = ''
    form.birthYear = null
    form.licenseNumber = ''
    // `categoryId` et le club ne sont PAS vidés : on saisit une catégorie, et
    // souvent un club, d'une traite. C'est tout l'intérêt de la saisie rapide.
    await refresh()
    // Les deux points d'entrée coexistent dans le code, jamais dans le DOM :
    // le formulaire en carte sous `lg`, la ligne du tableau au-dessus.
    quickFirstName.value?.focus()
    firstNameInput.value?.focus()
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onCreate(): void {
  formError.value = ''
  const result = createCompetitorInputSchema.safeParse({
    categoryId: form.categoryId,
    bib: form.bib,
    firstName: form.firstName,
    lastName: form.lastName,
    birthYear: form.birthYear,
    clubName: form.clubName.trim() || null,
    licenseNumber: form.licenseNumber.trim() || null,
  })
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  createCompetitor()
}

/** Échap abandonne la ligne en cours sans rien envoyer. */
function resetQuickAdd(): void {
  formError.value = ''
  form.bib = null
  form.firstName = ''
  form.lastName = ''
  form.birthYear = null
  form.clubName = ''
  form.licenseNumber = ''
}

// --- Assignation automatique des dossards ---
const { mutate: assignBibs, isPending: isAssigning } = useMutation({
  mutationFn: () => competitorsApi.assignBibs(props.competitionId),
  onSuccess: async () => {
    await refresh()
    toast.show('Dossards attribués.', 'success')
  },
})

// --- Recherche / filtre / tri ---
const search = ref('')
const categoryFilter = ref('')
const sort = ref<DataListSort | null>(null)
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return (competitors.value ?? []).filter((c) => {
    if (categoryFilter.value && c.categoryId !== categoryFilter.value) return false
    if (!term) return true
    return (
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(term) ||
      String(c.bib ?? '').includes(term)
    )
  })
})

// --- Édition / retrait ---
const editingId = ref<string | null>(null)
const editForm = reactive({ bib: null as number | null, categoryId: '' })
function startEdit(competitor: { id: string; bib: number | null; categoryId: string }): void {
  editingId.value = competitor.id
  editForm.bib = competitor.bib
  editForm.categoryId = competitor.categoryId
}
const { mutate: saveEdit, isPending: isSaving } = useMutation({
  mutationFn: () =>
    competitorsApi.update(props.competitionId, editingId.value ?? '', {
      bib: editForm.bib,
      categoryId: editForm.categoryId,
    }),
  onSuccess: async () => {
    editingId.value = null
    await refresh()
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Modification impossible.',
      'error',
    )
  },
})

// --- Statut jour J (Lot 8) — motif toujours facultatif, décision utilisateur ---
const STATUS_LABELS: Record<Competitor['status'], string> = {
  registered: 'Inscrit',
  present: 'Présent',
  withdrawn: 'Abandon',
  disqualified: 'Disqualifié',
}
const STATUS_TONES: Record<Competitor['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  registered: 'neutral',
  present: 'success',
  withdrawn: 'warning',
  disqualified: 'danger',
}
const STATUS_ORDER: readonly Competitor['status'][] = [
  'registered',
  'present',
  'withdrawn',
  'disqualified',
]
const statusOptions = (Object.keys(STATUS_LABELS) as Array<Competitor['status']>).map((value) => ({
  value,
  label: STATUS_LABELS[value],
}))

/**
 * Une seule définition de colonnes pour les deux rendus (Lot 18). Les colonnes
 * détaillées sont `card: 'hidden'` et la carte garde sa ligne d'identité d'un
 * seul tenant (`identity`, hors tableau) : le rendu mobile ne change pas.
 */
const columns = computed<DataListColumn<Competitor>[]>(() => [
  {
    key: 'identity',
    label: 'Compétiteur',
    card: 'title',
    tableHidden: true,
    value: (row) => `${row.bib ?? '—'} — ${row.firstName} ${row.lastName}`,
  },
  {
    key: 'bib',
    label: 'Dossard',
    card: 'hidden',
    cellClass: 'w-24',
    value: (row) => String(row.bib ?? '—'),
    compare: (a, b) => compareNumber(a.bib ?? 0, b.bib ?? 0),
    missing: (row) => row.bib === null,
  },
  {
    key: 'firstName',
    label: 'Prénom',
    card: 'hidden',
    value: (row) => row.firstName,
    compare: (a, b) => compareText(a.firstName, b.firstName),
  },
  {
    key: 'lastName',
    label: 'Nom',
    card: 'hidden',
    value: (row) => row.lastName,
    compare: (a, b) => compareText(a.lastName, b.lastName),
  },
  {
    key: 'category',
    label: 'Catégorie',
    card: 'subtitle',
    value: (row) => categoryLabel(row.categoryId),
    compare: (a, b) => compareText(categoryLabel(a.categoryId), categoryLabel(b.categoryId)),
  },
  {
    key: 'birthYear',
    label: 'Année',
    card: 'hidden',
    cellClass: 'w-20',
    value: (row) => String(row.birthYear ?? '—'),
    compare: (a, b) => compareNumber(a.birthYear ?? 0, b.birthYear ?? 0),
    missing: (row) => row.birthYear === null,
  },
  {
    key: 'clubName',
    label: 'Club',
    card: 'hidden',
    value: (row) => row.clubName ?? '—',
    compare: (a, b) => compareText(a.clubName ?? '', b.clubName ?? ''),
    missing: (row) => row.clubName === null || row.clubName === '',
  },
  {
    key: 'licenseNumber',
    label: 'Licence',
    card: 'hidden',
    cellClass: 'w-28',
    value: (row) => row.licenseNumber ?? '—',
  },
  {
    key: 'status',
    label: 'Statut',
    card: 'aside',
    cellClass: 'w-28',
    compare: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  },
  { key: 'actions', label: 'Actions', card: 'actions', labelHidden: true, cellClass: 'w-64' },
])

/** Le tri ne s'applique qu'au tableau : en cartes, aucun en-tête ne le commande. */
const shown = computed(() => sortRows(filtered.value, sort.value, columns.value))

/**
 * Action de ligne du tableau : compacte, mais jamais en dessous de 48 px sans
 * pointeur fin (ADR-073). Un `Button` de la charte ferait une pilule de 48 px
 * par action, soit trois fois la hauteur utile de la ligne.
 */
const rowActionClass =
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const dangerRowActionClass =
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50'

const statusTargetId = ref<string | null>(null)
const statusForm = reactive<{ status: Competitor['status']; reason: string }>({
  status: 'registered',
  reason: '',
})
function startStatusChange(competitor: Competitor): void {
  statusTargetId.value = competitor.id
  statusForm.status = competitor.status
  statusForm.reason = ''
}
function closeStatusChange(): void {
  statusTargetId.value = null
}
const { mutate: changeStatus, isPending: isChangingStatus } = useMutation({
  mutationFn: () =>
    competitorsApi.changeStatus(props.competitionId, statusTargetId.value ?? '', {
      status: statusForm.status,
      reason: statusForm.reason.trim() || undefined,
    }),
  onSuccess: async () => {
    statusTargetId.value = null
    await refresh()
    toast.show('Statut mis à jour.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Changement de statut impossible.',
      'error',
    )
  },
})

const confirmingDeleteId = ref<string | null>(null)
const { mutate: removeCompetitor, isPending: isDeleting } = useMutation({
  mutationFn: (id: string) => competitorsApi.remove(props.competitionId, id),
  onSuccess: async () => {
    confirmingDeleteId.value = null
    await refresh()
    toast.show('Compétiteur retiré.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Retrait impossible.',
      'error',
    )
    confirmingDeleteId.value = null
  },
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!--
      Deux chemins d'ajout ne sont jamais visibles ensemble : le formulaire en
      carte sous 1024 px, la ligne du tableau au-dessus (Lot 18).
    -->
    <form
      v-if="!isDesktop"
      class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
      @submit.prevent="onCreate"
    >
      <h2 class="font-medium text-gray-900">Ajouter un compétiteur</h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <TextField ref="firstNameInput" v-model="form.firstName" label="Prénom" required />
        <TextField v-model="form.lastName" label="Nom" required />
        <Select v-model="form.categoryId" label="Catégorie" :options="categoryOptions" required />
        <NumberField v-model="form.bib" label="Dossard (optionnel)" :min="1" />
      </div>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button type="submit" :disabled="isCreating">{{ isCreating ? 'Ajout…' : 'Ajouter' }}</Button>
    </form>

    <CompetitorImportWizard :competition-id="competitionId" @imported="refresh" />

    <ListToolbar>
      <div class="lg:w-72">
        <TextField v-model="search" label="Rechercher (nom ou dossard)" />
      </div>
      <div class="lg:w-56">
        <Select
          v-model="categoryFilter"
          label="Filtrer par catégorie"
          :options="[{ value: '', label: 'Toutes' }, ...categoryOptions]"
        />
      </div>
      <template #actions>
        <Button variant="secondary" :disabled="isAssigning" @click="assignBibs()">
          {{ isAssigning ? 'Attribution…' : 'Assigner les dossards automatiquement' }}
        </Button>
      </template>
    </ListToolbar>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <DataList
      v-else
      :rows="shown"
      :columns="columns"
      :layout="isDesktop ? 'table' : 'cards'"
      :sort="sort"
      label="Compétiteurs"
      empty-text="Aucun compétiteur."
      @update:sort="sort = $event"
    >
      <!--
        Saisie au kilomètre : des champs natifs étiquetés par les en-têtes de
        colonne. `TextField` afficherait son étiquette au-dessus et tripleraient
        la hauteur de la ligne. Entrée valide, Échap abandonne.
      -->
      <template #quick-add="{ columnCount, headerId }">
        <tr class="border-b border-gray-200 bg-blue-50">
          <th scope="row" class="px-3 py-2">
            <input
              v-model.number="form.bib"
              type="number"
              inputmode="numeric"
              min="1"
              placeholder="Auto"
              :aria-labelledby="headerId('bib')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </th>
          <td class="px-3 py-2">
            <input
              ref="quickFirstName"
              v-model="form.firstName"
              type="text"
              placeholder="Prénom"
              :aria-labelledby="headerId('firstName')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </td>
          <td class="px-3 py-2">
            <input
              v-model="form.lastName"
              type="text"
              placeholder="Nom"
              :aria-labelledby="headerId('lastName')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </td>
          <td class="px-3 py-2">
            <select
              v-model="form.categoryId"
              :aria-labelledby="headerId('category')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
            >
              <option value="">Catégorie…</option>
              <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </td>
          <td class="px-3 py-2">
            <input
              v-model.number="form.birthYear"
              type="number"
              inputmode="numeric"
              placeholder="Année"
              :aria-labelledby="headerId('birthYear')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </td>
          <td class="px-3 py-2">
            <input
              v-model="form.clubName"
              type="text"
              placeholder="Club"
              :aria-labelledby="headerId('clubName')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </td>
          <td class="px-3 py-2">
            <input
              v-model="form.licenseNumber"
              type="text"
              placeholder="Licence"
              :aria-labelledby="headerId('licenseNumber')"
              class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
              @keydown.enter.prevent="onCreate"
              @keydown.esc="resetQuickAdd"
            />
          </td>
          <td class="px-3 py-2" colspan="2">
            <button
              type="button"
              :disabled="isCreating"
              class="fine:min-h-10 inline-flex min-h-12 items-center rounded-full bg-blue-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              @click="onCreate"
            >
              {{ isCreating ? 'Ajout…' : 'Ajouter' }}
            </button>
          </td>
        </tr>
        <tr v-if="formError">
          <td :colspan="columnCount" class="px-3 pb-2">
            <p role="alert" class="text-sm text-red-700">{{ formError }}</p>
          </td>
        </tr>
      </template>

      <!--
        En tableau : des champs natifs étiquetés par leur en-tête, pour tenir sur
        une ligne. En cartes : les mêmes `NumberField`/`Select` qu'avant, aux
        emplacements du titre et du sous-titre.
      -->
      <template #cell-bib="{ row }">
        <input
          v-if="editingId === row.id"
          v-model.number="editForm.bib"
          type="number"
          inputmode="numeric"
          min="1"
          aria-label="Dossard"
          class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
        />
        <template v-else>{{ row.bib ?? '—' }}</template>
      </template>

      <template #cell-identity="{ row }">
        <NumberField v-if="editingId === row.id" v-model="editForm.bib" label="Dossard" :min="1" />
        <span v-else class="font-medium text-gray-900"
          >{{ row.bib ?? '—' }} — {{ row.firstName }} {{ row.lastName }}</span
        >
      </template>

      <template #cell-category="{ row }">
        <template v-if="editingId === row.id">
          <select
            v-if="isDesktop"
            v-model="editForm.categoryId"
            aria-label="Catégorie"
            class="fine:min-h-10 min-h-12 w-full rounded-lg border border-gray-400 bg-white px-2 text-sm"
          >
            <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <Select
            v-else
            v-model="editForm.categoryId"
            label="Catégorie"
            :options="categoryOptions"
          />
        </template>
        <template v-else>{{ categoryLabel(row.categoryId) }}</template>
      </template>

      <template #cell-status="{ row }">
        <Badge :tone="STATUS_TONES[row.status]">{{ STATUS_LABELS[row.status] }}</Badge>
      </template>

      <!--
        Les actions de ligne du tableau sont des `<button>` nus : `Button` est la
        pilule de 48 px de la charte, et lui donner une variante compacte la
        rendrait compacte jusque sur les écrans juge (ADR-073).
      -->
      <template #cell-actions="{ row }">
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="isDesktop">
            <template v-if="editingId === row.id">
              <button
                type="button"
                :disabled="isSaving"
                :class="rowActionClass"
                @click="saveEdit()"
              >
                Enregistrer
              </button>
              <button type="button" :class="rowActionClass" @click="editingId = null">
                Annuler
              </button>
            </template>
            <template v-else-if="confirmingDeleteId === row.id">
              <button
                type="button"
                :disabled="isDeleting"
                :class="dangerRowActionClass"
                @click="removeCompetitor(row.id)"
              >
                Confirmer
              </button>
              <button type="button" :class="rowActionClass" @click="confirmingDeleteId = null">
                Annuler
              </button>
            </template>
            <template v-else>
              <button type="button" :class="rowActionClass" @click="startStatusChange(row)">
                Statut
              </button>
              <button type="button" :class="rowActionClass" @click="startEdit(row)">
                Modifier
              </button>
              <button type="button" :class="rowActionClass" @click="confirmingDeleteId = row.id">
                Retirer
              </button>
            </template>
          </template>
          <template v-else>
            <template v-if="editingId === row.id">
              <Button :disabled="isSaving" @click="saveEdit()">Enregistrer</Button>
              <Button variant="secondary" @click="editingId = null">Annuler</Button>
            </template>
            <template v-else-if="confirmingDeleteId === row.id">
              <Button variant="danger" :disabled="isDeleting" @click="removeCompetitor(row.id)"
                >Confirmer</Button
              >
              <Button variant="secondary" @click="confirmingDeleteId = null">Annuler</Button>
            </template>
            <template v-else>
              <Button variant="secondary" @click="startStatusChange(row)">Statut</Button>
              <Button variant="secondary" @click="startEdit(row)">Modifier</Button>
              <Button variant="secondary" @click="confirmingDeleteId = row.id">Retirer</Button>
            </template>
          </template>
        </div>
      </template>
    </DataList>

    <Modal :open="statusTargetId !== null" title="Statut du compétiteur" @close="closeStatusChange">
      <form class="flex flex-col gap-4" @submit.prevent="changeStatus()">
        <Select v-model="statusForm.status" label="Statut" :options="statusOptions" required />
        <TextField v-model="statusForm.reason" label="Motif (optionnel)" />
        <div class="flex gap-2">
          <Button type="submit" :disabled="isChangingStatus">
            {{ isChangingStatus ? 'Enregistrement…' : 'Enregistrer' }}
          </Button>
          <Button type="button" variant="secondary" @click="closeStatusChange">Annuler</Button>
        </div>
      </form>
    </Modal>
  </div>
</template>
