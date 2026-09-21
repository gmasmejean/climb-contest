<script setup lang="ts">
import {
  createJudgeInputSchema,
  type Competition,
  type JudgeCreated,
} from '@climbcontest/contracts'
import {
  Badge,
  Button,
  DataList,
  Modal,
  useToast,
  type DataListColumn,
  type DataListSort,
} from '@climbcontest/ui'
import { computed, reactive, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { ApiError } from '../../../api/client'
import { competitionsApi, routesApi } from '../../../api/competitions'
import { judgesApi, revealedJudgeTokens, type JudgeWithRoutes } from '../../../api/judges'
import { DESKTOP_QUERY, useMediaQuery } from '../../../composables/useMediaQuery'
import { compareText, sortRows } from '../../../lib/table-sort'

const props = defineProps<{ competition: Competition }>()

const isDesktop = useMediaQuery(DESKTOP_QUERY)

const queryClient = useQueryClient()
const toast = useToast()
const judgesKey = ['competitions', props.competition.id, 'judges']
const routesKey = ['competitions', props.competition.id, 'routes']

const { data: judges, isPending } = useQuery({
  queryKey: judgesKey,
  queryFn: () => judgesApi.list(props.competition.id),
})
const { data: routes } = useQuery({
  queryKey: routesKey,
  queryFn: () => routesApi.list(props.competition.id),
})

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: judgesKey })
}

function updateCompetitionSetting(field: 'judgePinRequired' | 'judgeCredentialsStored') {
  return useMutation({
    mutationFn: (value: boolean) =>
      competitionsApi.update(props.competition.id, { [field]: value }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['competitions', props.competition.id], updated)
      await queryClient.invalidateQueries({ queryKey: ['competitions'] })
      // Désactiver la conservation en clair efface le clair déjà stocké côté
      // serveur (DECISIONS.md ADR-027) — la liste doit refléter ça aussitôt.
      if (field === 'judgeCredentialsStored') await refresh()
    },
  })
}
const pinRequiredMutation = updateCompetitionSetting('judgePinRequired')
const credentialsStoredMutation = updateCompetitionSetting('judgeCredentialsStored')
function togglePinRequired(event: Event): void {
  pinRequiredMutation.mutate((event.target as HTMLInputElement).checked)
}
function toggleCredentialsStored(event: Event): void {
  credentialsStoredMutation.mutate((event.target as HTMLInputElement).checked)
}

function emptyForm() {
  return { displayName: '', routeIds: [] as string[], email: '' }
}
const form = reactive(emptyForm())
const formError = ref('')

const createMutation = useMutation({
  mutationFn: () =>
    judgesApi.create(props.competition.id, { ...form, email: form.email || undefined }),
  onSuccess: async (created) => {
    Object.assign(form, emptyForm())
    revealedJudge.value = created
    // Gardé en mémoire même quand le serveur stocke déjà le clair : c'est ce
    // qui permet d'inclure ce juge dans une planche téléchargée plus tard
    // dans la même session sans attendre le prochain rechargement de la liste.
    revealedJudgeTokens.value.push({
      competitionId: props.competition.id,
      judgeId: created.id,
      accessToken: created.accessToken,
    })
    await refresh()
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.'
  },
})

function onSubmit(): void {
  formError.value = ''
  const result = createJudgeInputSchema.safeParse({ ...form, email: form.email || undefined })
  if (!result.success) {
    formError.value = result.error.issues[0]?.message ?? 'Formulaire invalide.'
    return
  }
  createMutation.mutate()
}

const revealedJudge = ref<JudgeCreated | null>(null)
function closeReveal(): void {
  revealedJudge.value = null
}

// Accès déjà stocké en clair, revu à tout moment depuis la liste (ADR-027) —
// distinct de `revealedJudge` (juste après création) : pas de mise en garde
// « plus jamais affiché » ici, puisque justement ce n'est pas le cas.
const viewedJudge = ref<{ displayName: string; accessUrl: string; pin?: string } | null>(null)
function viewAccess(j: JudgeWithRoutes): void {
  if (!j.accessUrl) return
  viewedJudge.value = {
    displayName: j.displayName,
    accessUrl: j.accessUrl,
    ...(j.pin ? { pin: j.pin } : {}),
  }
}
function closeViewed(): void {
  viewedJudge.value = null
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.show('Copié.', 'success')
  } catch {
    toast.show('Copie impossible — sélectionnez le texte manuellement.', 'error')
  }
}

const revokeMutation = useMutation({
  mutationFn: (judgeId: string) => judgesApi.revoke(props.competition.id, judgeId),
  onSuccess: () => refresh(),
})

const regeneratedPin = ref<{ displayName: string; pin: string } | null>(null)
const regenerateMutation = useMutation({
  mutationFn: (judgeId: string) => judgesApi.regeneratePin(props.competition.id, judgeId),
  onSuccess: async (result, judgeId) => {
    const target = judges.value?.find((j) => j.id === judgeId)
    regeneratedPin.value = { displayName: target?.displayName ?? '', pin: result.pin }
    await refresh()
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError
        ? (error.detail ?? error.title)
        : 'Une erreur inattendue est survenue.',
      'error',
    )
  },
})
function closeRegenerated(): void {
  regeneratedPin.value = null
}

// Un juge manque à la planche seulement s'il n'a ni accès stocké en clair
// (ADR-027) ni jeton encore tenu en mémoire pour cette session (ADR-026).
const missingFromSheet = computed(
  () =>
    judges.value?.filter(
      (j) =>
        !j.revokedAt &&
        !j.accessUrl &&
        !revealedJudgeTokens.value.some(
          (t) => t.competitionId === props.competition.id && t.judgeId === j.id,
        ),
    ) ?? [],
)
const isDownloading = ref(false)
async function downloadQrSheet(): Promise<void> {
  isDownloading.value = true
  try {
    const tokensThisCompetition = revealedJudgeTokens.value
      .filter((t) => t.competitionId === props.competition.id)
      .map(({ judgeId, accessToken }) => ({ judgeId, accessToken }))
    const blob = await judgesApi.downloadQrSheet(props.competition.id, tokensThisCompetition)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `juges-${props.competition.publicSlug}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.show('Impossible de générer la planche.', 'error')
  } finally {
    isDownloading.value = false
  }
}

function judgeStatus(j: JudgeWithRoutes): {
  label: string
  tone: 'neutral' | 'success' | 'warning' | 'danger'
} {
  if (j.revokedAt) return { label: 'Révoqué', tone: 'danger' }
  if (j.lockedUntil && new Date(j.lockedUntil).getTime() > Date.now()) {
    return { label: 'Bloqué (PIN)', tone: 'warning' }
  }
  return { label: 'Actif', tone: 'success' }
}

function routeLabels(routeIds: string[]): string {
  if (!routes.value || routeIds.length === 0) return '—'
  return routeIds
    .map((id) => routes.value?.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .map((r) => `Voie ${r.number}`)
    .join(', ')
}

/** Le dernier signe de vie n'existe qu'après la première connexion du juge. */
function lastSeenLabel(j: JudgeWithRoutes): string {
  if (!j.lastSeenAt) return 'Jamais'
  return new Date(j.lastSeenAt).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

/** Ordre d'urgence : c'est un révoqué ou un bloqué qu'on cherche dans la liste. */
const STATUS_RANK: Record<string, number> = { Révoqué: 0, 'Bloqué (PIN)': 1, Actif: 2 }
const statusRank = (j: JudgeWithRoutes): number => STATUS_RANK[judgeStatus(j).label] ?? 0

const sort = ref<DataListSort | null>(null)

const columns = computed<DataListColumn<JudgeWithRoutes>[]>(() => [
  {
    key: 'displayName',
    label: 'Juge',
    card: 'title',
    value: (row) => row.displayName,
    compare: (a, b) => compareText(a.displayName, b.displayName),
  },
  {
    key: 'status',
    label: 'Statut',
    card: 'aside',
    cellClass: 'w-32',
    compare: (a, b) => statusRank(a) - statusRank(b),
  },
  { key: 'pin', label: 'PIN', card: 'aside', cellClass: 'w-40' },
  { key: 'routes', label: 'Voies', card: 'subtitle', value: (row) => routeLabels(row.routeIds) },
  {
    key: 'lastSeen',
    label: 'Dernier accès',
    card: 'hidden',
    cellClass: 'w-36',
    value: lastSeenLabel,
    compare: (a, b) =>
      new Date(a.lastSeenAt ?? 0).getTime() - new Date(b.lastSeenAt ?? 0).getTime(),
    missing: (row) => row.lastSeenAt === null,
  },
  { key: 'actions', label: 'Actions', card: 'actions', labelHidden: true, cellClass: 'w-72' },
])

const shown = computed(() => sortRows(judges.value ?? [], sort.value, columns.value))

/**
 * Action de ligne du tableau : compacte sous pointeur fin seulement (ADR-073).
 * `Button` reste la pilule de 48 px de la charte, y compris en cartes.
 */
const rowActionClass =
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const dangerRowActionClass =
  'fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50'
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <label class="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          :checked="competition.judgePinRequired"
          class="h-5 w-5 rounded border-gray-400"
          @change="togglePinRequired"
        />
        <span class="text-sm text-gray-900">
          Exiger un PIN pour les nouveaux juges
          <span class="block text-xs text-gray-600">
            Ne concerne que les juges créés à partir de maintenant — sans effet sur les juges déjà
            créés.
          </span>
        </span>
      </label>
      <label class="flex min-h-12 items-center gap-3">
        <input
          type="checkbox"
          :checked="competition.judgeCredentialsStored"
          class="h-5 w-5 rounded border-gray-400"
          @change="toggleCredentialsStored"
        />
        <span class="text-sm text-gray-900">
          Conserver les accès en clair, consultables à tout moment
          <span class="block text-xs text-gray-600">
            Pratique pour un club sans enjeu important — moins sûr si la base de données venait à
            fuiter. Désactiver efface aussitôt le lien et le PIN déjà stockés pour les juges de
            cette compétition ; les juges créés ensuite ne montreront leur accès qu'une seule fois.
          </span>
        </span>
      </label>
    </div>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <DataList
      v-else
      :rows="shown"
      :columns="columns"
      :layout="isDesktop ? 'table' : 'cards'"
      :sort="sort"
      label="Juges"
      empty-text="Aucun juge."
      @update:sort="sort = $event"
    >
      <template #cell-status="{ row }">
        <Badge :tone="judgeStatus(row).tone">{{ judgeStatus(row).label }}</Badge>
      </template>

      <!-- En tableau, une colonne se lit mieux pleine que vide : « Oui » plutôt
           qu'une pastille qui n'apparaît qu'en creux. -->
      <template #cell-pin="{ row }">
        <template v-if="isDesktop">{{ row.hasPin ? 'Oui' : 'Accès direct' }}</template>
        <Badge v-else-if="!row.hasPin" tone="neutral">Accès direct — pas de PIN</Badge>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="isDesktop">
            <button
              v-if="row.accessUrl"
              type="button"
              :class="rowActionClass"
              @click="viewAccess(row)"
            >
              Voir l'accès
            </button>
            <button
              v-if="row.hasPin && !row.revokedAt"
              type="button"
              :class="rowActionClass"
              :disabled="regenerateMutation.isPending.value"
              @click="regenerateMutation.mutate(row.id)"
            >
              Régénérer le PIN
            </button>
            <button
              v-if="!row.revokedAt"
              type="button"
              :class="dangerRowActionClass"
              :disabled="revokeMutation.isPending.value"
              @click="revokeMutation.mutate(row.id)"
            >
              Révoquer
            </button>
          </template>
          <template v-else>
            <Button v-if="row.accessUrl" variant="secondary" @click="viewAccess(row)">
              Voir l'accès
            </Button>
            <Button
              v-if="row.hasPin && !row.revokedAt"
              variant="secondary"
              :disabled="regenerateMutation.isPending.value"
              @click="regenerateMutation.mutate(row.id)"
            >
              Régénérer le PIN
            </Button>
            <Button
              v-if="!row.revokedAt"
              variant="danger"
              :disabled="revokeMutation.isPending.value"
              @click="revokeMutation.mutate(row.id)"
            >
              Révoquer
            </Button>
          </template>
        </div>
      </template>
    </DataList>

    <Button variant="secondary" :disabled="isDownloading" @click="downloadQrSheet">
      {{ isDownloading ? 'Génération…' : 'Planche de QR codes (PDF)' }}
    </Button>
    <p v-if="missingFromSheet.length > 0" class="text-xs text-gray-500">
      {{ missingFromSheet.length }} juge(s) sans accès en clair conservé n'apparaîtront pas en
      encart individuel sur la planche (seulement sur sa page QR publique), sauf à avoir été créés
      lors de cette session.
    </p>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
      @submit.prevent="onSubmit"
    >
      <h2 class="font-medium text-gray-900">Ajouter un juge</h2>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium text-gray-900">Nom affiché</span>
        <input
          v-model="form.displayName"
          type="text"
          class="min-h-12 rounded-lg border border-gray-400 bg-white px-3 text-base"
          required
        />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium text-gray-900">E-mail (optionnel)</span>
        <input
          v-model="form.email"
          type="email"
          placeholder="pour envoyer le lien d'accès directement"
          class="min-h-12 rounded-lg border border-gray-400 bg-white px-3 text-base"
        />
      </label>
      <fieldset class="flex flex-col gap-2">
        <legend class="text-sm font-medium text-gray-900">Voies assignées</legend>
        <label v-for="r in routes ?? []" :key="r.id" class="flex min-h-12 items-center gap-2">
          <input
            v-model="form.routeIds"
            type="checkbox"
            :value="r.id"
            class="h-5 w-5 rounded border-gray-400"
          />
          Voie {{ r.number }}<span v-if="r.name"> — {{ r.name }}</span>
        </label>
        <p v-if="routes && routes.length === 0" class="text-sm text-gray-600">
          Créez d'abord une voie dans l'onglet « Voies ».
        </p>
      </fieldset>
      <p v-if="formError" role="alert" class="text-sm text-red-700">{{ formError }}</p>
      <Button type="submit" :disabled="createMutation.isPending.value">
        {{ createMutation.isPending.value ? 'Création…' : 'Créer le juge' }}
      </Button>
    </form>

    <Modal
      :open="revealedJudge !== null"
      title="Accès du juge — à noter maintenant"
      @close="closeReveal"
    >
      <div v-if="revealedJudge" class="flex flex-col gap-4">
        <p
          class="text-sm"
          :class="competition.judgeCredentialsStored ? 'text-gray-600' : 'text-red-700'"
        >
          {{
            competition.judgeCredentialsStored
              ? 'Vous pourrez revoir cet accès à tout moment depuis la liste des juges (bouton « Voir l’accès »).'
              : `Ce lien${revealedJudge.pin ? ' et ce PIN ne' : ' ne'} sera plus jamais affiché. Notez-le${revealedJudge.pin ? 's' : ''} ou imprimez la planche maintenant.`
          }}
        </p>
        <p v-if="revealedJudge.emailSent === true" class="text-sm text-green-700">
          Le lien d'accès a été envoyé par e-mail.
        </p>
        <p v-else-if="revealedJudge.emailSent === false" class="text-sm text-amber-700">
          L'envoi de l'e-mail a échoué — communiquez l'accès autrement.
        </p>
        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium text-gray-900">Lien d'accès</span>
          <div class="flex gap-2">
            <input
              readonly
              :value="revealedJudge.accessUrl"
              class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm"
            />
            <Button variant="secondary" @click="copy(revealedJudge.accessUrl)">Copier</Button>
          </div>
        </div>
        <div v-if="revealedJudge.pin" class="flex flex-col gap-1">
          <span class="text-sm font-medium text-gray-900">PIN</span>
          <div class="flex gap-2">
            <input
              readonly
              :value="revealedJudge.pin"
              class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-lg tracking-widest"
            />
            <Button variant="secondary" @click="copy(revealedJudge.pin)">Copier</Button>
          </div>
        </div>
        <Button @click="closeReveal">J'ai noté l'accès</Button>
      </div>
    </Modal>

    <Modal :open="viewedJudge !== null" title="Accès du juge" @close="closeViewed">
      <div v-if="viewedJudge" class="flex flex-col gap-4">
        <p class="text-sm text-gray-600">Accès de {{ viewedJudge.displayName }}.</p>
        <div class="flex flex-col gap-1">
          <span class="text-sm font-medium text-gray-900">Lien d'accès</span>
          <div class="flex gap-2">
            <input
              readonly
              :value="viewedJudge.accessUrl"
              class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm"
            />
            <Button variant="secondary" @click="copy(viewedJudge.accessUrl)">Copier</Button>
          </div>
        </div>
        <div v-if="viewedJudge.pin" class="flex flex-col gap-1">
          <span class="text-sm font-medium text-gray-900">PIN</span>
          <div class="flex gap-2">
            <input
              readonly
              :value="viewedJudge.pin"
              class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-lg tracking-widest"
            />
            <Button variant="secondary" @click="copy(viewedJudge.pin)">Copier</Button>
          </div>
        </div>
        <Button @click="closeViewed">Fermer</Button>
      </div>
    </Modal>

    <Modal
      :open="regeneratedPin !== null"
      title="Nouveau PIN — à noter maintenant"
      @close="closeRegenerated"
    >
      <div v-if="regeneratedPin" class="flex flex-col gap-4">
        <p
          class="text-sm"
          :class="competition.judgeCredentialsStored ? 'text-gray-600' : 'text-red-700'"
        >
          {{
            competition.judgeCredentialsStored
              ? `Vous pourrez le revoir à tout moment depuis la liste des juges.`
              : `Ce PIN ne sera plus jamais affiché — communiquez-le à ${regeneratedPin.displayName} maintenant.`
          }}
        </p>
        <div class="flex gap-2">
          <input
            readonly
            :value="regeneratedPin.pin"
            class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-lg tracking-widest"
          />
          <Button variant="secondary" @click="copy(regeneratedPin.pin)">Copier</Button>
        </div>
        <Button @click="closeRegenerated">J'ai noté le PIN</Button>
      </div>
    </Modal>
  </div>
</template>
