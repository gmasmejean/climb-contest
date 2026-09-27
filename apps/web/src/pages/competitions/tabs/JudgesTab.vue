<script setup lang="ts">
import { type Competition, type JudgeCreated } from '@climbcontest/contracts'
import {
  Badge,
  Button,
  DataList,
  Modal,
  useToast,
  type DataListColumn,
  type DataListSort,
} from '@climbcontest/ui'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { ApiError } from '../../../api/client'
import { competitionsApi, routesApi } from '../../../api/competitions'
import { judgesApi, revealedJudgeTokens, type JudgeWithRoutes } from '../../../api/judges'
import {
  DESKTOP_QUERY,
  MASTER_DETAIL_QUERY,
  useMediaQuery,
  WIDE_QUERY,
} from '../../../composables/useMediaQuery'
import { judgeAccessUrl } from '../../../lib/judge-access'
import { compareText, sortRows } from '../../../lib/table-sort'
import JudgeEditorPanel from '../JudgeEditorPanel.vue'
import JudgeCard from '../JudgeCard.vue'

const props = defineProps<{ competition: Competition }>()

const isDesktop = useMediaQuery(DESKTOP_QUERY)
// Le tableau arrive à 1024 px, la fiche seulement à 1440 px : entre les deux, la
// place manque pour les deux côte à côte (ADR-075, seuil mesuré).
const isMasterDetail = useMediaQuery(MASTER_DETAIL_QUERY)
const isWide = useMediaQuery(WIDE_QUERY)

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

// Le juge ouvert vit dans l'adresse (ADR-075 point 4), comme la voie ouverte.
const urlRoute = useRoute()
const router = useRouter()
const selectedJudgeId = computed<string | null>({
  get: () => {
    const requested = urlRoute.query.judge
    if (typeof requested !== 'string' || requested === '') return null
    if (judges.value && !judges.value.some((j) => j.id === requested)) return null
    return requested
  },
  set: (id) => {
    const query = { ...urlRoute.query }
    delete query.judge
    void router.replace({ query: id === null ? query : { ...query, judge: id } })
  },
})
const selectedJudge = computed(() => judges.value?.find((j) => j.id === selectedJudgeId.value))

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

// Juge en cours de modification dans le panneau (`null` = panneau en mode
// ajout, ou fiche si un juge est sélectionné en maître–détail). Local plutôt
// que dans l'adresse : contrairement à la voie ouverte, l'édition d'un juge
// est une action ponctuelle, pas un lien profond à préserver au rechargement.
const editingJudgeId = ref<string | null>(null)
const editingJudge = computed(() => judges.value?.find((j) => j.id === editingJudgeId.value))

async function onJudgeSaved(created?: JudgeCreated): Promise<void> {
  editingJudgeId.value = null
  if (created) {
    revealedJudge.value = created
    // Gardé en mémoire même quand le serveur stocke déjà le clair : c'est ce
    // qui permet d'inclure ce juge dans une planche téléchargée plus tard
    // dans la même session sans attendre le prochain rechargement de la liste.
    revealedJudgeTokens.value.push({
      competitionId: props.competition.id,
      judgeId: created.id,
      accessToken: created.accessToken,
    })
  }
  await refresh()
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

// Affichée seulement quand le renvoi a dû régénérer l'accès (ADR-081) : sinon
// le lien existait déjà et reste consultable via « Voir l'accès »/la fiche —
// un simple toast suffit.
const resentAccess = ref<{ displayName: string; accessUrl: string; emailFailed: boolean } | null>(
  null,
)
const resendMutation = useMutation({
  mutationFn: (judgeId: string) => judgesApi.resendAccess(props.competition.id, judgeId),
  onSuccess: async (result, judgeId) => {
    const target = judges.value?.find((j) => j.id === judgeId)
    if (result.regenerated) {
      resentAccess.value = {
        displayName: target?.displayName ?? '',
        accessUrl: result.accessUrl,
        emailFailed: !result.emailSent,
      }
    } else {
      toast.show(
        result.emailSent
          ? 'Accès renvoyé par e-mail.'
          : "L'envoi a échoué — l'accès n'a pas changé, réessayez ou communiquez-le autrement.",
        result.emailSent ? 'success' : 'error',
      )
    }
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
function closeResentAccess(): void {
  resentAccess.value = null
}

/** Le lien affichable d'un juge : clair stocké (ADR-027) ou jeton de session (ADR-026). */
function accessUrlOf(j: JudgeWithRoutes): string | null {
  return judgeAccessUrl(j, revealedJudgeTokens.value, props.competition.id, window.location.origin)
}

// Un juge manque à la planche exactement quand il n'a aucun lien affichable.
const missingFromSheet = computed(
  () => judges.value?.filter((j) => !j.revokedAt && accessUrlOf(j) === null) ?? [],
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
  // Colonnes de confort (ADR-074 point 7) : entre 1280 et 1440 px seulement. En
  // dessous, ou en maître–détail, leurs largeurs fixes réduisent « Juge » à une
  // soixantaine de pixels et poussent les actions hors de l'écran — la fiche,
  // elle, montre le PIN et le dernier accès du juge ouvert.
  {
    key: 'pin',
    label: 'PIN',
    card: 'aside',
    cellClass: 'w-40',
    tableHidden: isMasterDetail.value || !isWide.value,
  },
  { key: 'routes', label: 'Voies', card: 'subtitle', value: (row) => routeLabels(row.routeIds) },
  {
    key: 'lastSeen',
    label: 'Dernier accès',
    card: 'hidden',
    cellClass: 'w-36',
    tableHidden: isMasterDetail.value || !isWide.value,
    value: lastSeenLabel,
    compare: (a, b) =>
      new Date(a.lastSeenAt ?? 0).getTime() - new Date(b.lastSeenAt ?? 0).getTime(),
    missing: (row) => row.lastSeenAt === null,
  },
  {
    key: 'actions',
    label: 'Actions',
    card: 'actions',
    labelHidden: true,
    // En tableau, la ligne n'ouvre que la fiche ; les actions y vivent (ADR-075 point 6).
    cellClass: isMasterDetail.value ? 'w-24' : 'w-72',
  },
])

const shown = computed(() => sortRows(judges.value ?? [], sort.value, columns.value))

/**
 * Action de ligne du tableau : compacte sous pointeur fin seulement (ADR-073).
 * `Button` reste la pilule de 48 px de la charte, y compris en cartes. Depuis le
 * Lot 19, au-dessus de 1440 px la seule action de ligne est l'ouverture de la
 * fiche ; entre 1024 et 1440 px, le tableau garde les actions du Lot 18.
 */
const rowActionClass =
  'fine:min-h-8 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50'
const dangerRowActionClass =
  'fine:min-h-8 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50'
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
            Pratique pour une organisation sans enjeu important — moins sûr si la base de données venait à
            fuiter. Désactiver efface aussitôt le lien et le PIN déjà stockés pour les juges de
            cette compétition ; les juges créés ensuite ne montreront leur accès qu'une seule fois.
          </span>
        </span>
      </label>
    </div>

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <!-- Maître–détail à partir de `lg` (ADR-075) ; `minmax(0,1fr)` garde le
         tableau dans sa colonne. -->
    <div
      v-else
      class="flex flex-col gap-6 min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_24rem] min-[1440px]:items-start min-[1440px]:gap-8"
    >
      <div class="flex min-w-0 flex-col gap-6">
        <DataList
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
              <!-- Dès qu'il y a une fiche, la ligne n'ouvre qu'elle : les actions
                   y vivent, jamais aux deux endroits (ADR-074 point 2). -->
              <button
                v-if="isMasterDetail"
                type="button"
                :class="rowActionClass"
                :aria-current="row.id === selectedJudgeId ? 'true' : undefined"
                @click="selectedJudgeId = row.id"
              >
                Fiche
              </button>
              <!-- Entre 1024 et 1440 px : un tableau, mais pas de place pour une
                   fiche à côté — les actions du Lot 18 restent sur la ligne. -->
              <template v-else-if="isDesktop">
                <button
                  v-if="!row.revokedAt"
                  type="button"
                  :class="rowActionClass"
                  @click="editingJudgeId = row.id"
                >
                  Modifier
                </button>
                <button
                  v-if="row.accessUrl"
                  type="button"
                  :class="rowActionClass"
                  @click="viewAccess(row)"
                >
                  Voir l'accès
                </button>
                <button
                  v-if="row.email && !row.revokedAt"
                  type="button"
                  :class="rowActionClass"
                  :disabled="resendMutation.isPending.value"
                  @click="resendMutation.mutate(row.id)"
                >
                  Renvoyer les accès par e-mail
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
                <Button v-if="!row.revokedAt" variant="secondary" @click="editingJudgeId = row.id">
                  Modifier
                </Button>
                <Button v-if="row.accessUrl" variant="secondary" @click="viewAccess(row)">
                  Voir l'accès
                </Button>
                <Button
                  v-if="row.email && !row.revokedAt"
                  variant="secondary"
                  :disabled="resendMutation.isPending.value"
                  @click="resendMutation.mutate(row.id)"
                >
                  Renvoyer les accès par e-mail
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
          encart individuel sur la planche (seulement sur sa page QR publique), sauf à avoir été
          créés lors de cette session.
        </p>
      </div>

      <div class="min-[1440px]:sticky min-[1440px]:top-24">
        <!-- L'édition prend le pas sur la fiche (comme sur les voies, ADR-075
             point 8) : jamais les deux affichées à la fois. -->
        <JudgeCard
          v-if="editingJudgeId === null && isMasterDetail && selectedJudge"
          :judge="selectedJudge"
          :status="judgeStatus(selectedJudge)"
          :route-labels="routeLabels(selectedJudge.routeIds)"
          :last-seen-label="lastSeenLabel(selectedJudge)"
          :access-url="accessUrlOf(selectedJudge)"
          :revoking="revokeMutation.isPending.value"
          :regenerating="regenerateMutation.isPending.value"
          :resending="resendMutation.isPending.value"
          @copy="copy"
          @revoke="revokeMutation.mutate(selectedJudge.id)"
          @regenerate-pin="regenerateMutation.mutate(selectedJudge.id)"
          @edit="editingJudgeId = selectedJudge.id"
          @resend-access="resendMutation.mutate(selectedJudge.id)"
          @close="selectedJudgeId = null"
        />
        <JudgeEditorPanel
          v-else
          :competition-id="competition.id"
          :judge="editingJudgeId !== null ? (editingJudge ?? null) : null"
          :routes="routes ?? []"
          @saved="onJudgeSaved"
          @cancel="editingJudgeId = null"
        />
      </div>
    </div>

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

    <Modal :open="!isMasterDetail && viewedJudge !== null" title="Accès du juge" @close="closeViewed">
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

    <Modal
      :open="resentAccess !== null"
      title="Nouvel accès envoyé — à noter maintenant"
      @close="closeResentAccess"
    >
      <div v-if="resentAccess" class="flex flex-col gap-4">
        <p class="text-sm text-red-700">
          L'ancien lien de {{ resentAccess.displayName }} ne fonctionne plus. Ce nouveau lien ne
          sera peut-être plus jamais affiché — notez-le maintenant.
        </p>
        <p v-if="resentAccess.emailFailed" class="text-sm text-amber-700">
          L'envoi de l'e-mail a échoué — communiquez ce lien autrement.
        </p>
        <p v-else class="text-sm text-green-700">Le lien a aussi été envoyé par e-mail.</p>
        <div class="flex gap-2">
          <input
            readonly
            :value="resentAccess.accessUrl"
            class="min-h-12 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm"
          />
          <Button variant="secondary" @click="copy(resentAccess.accessUrl)">Copier</Button>
        </div>
        <Button @click="closeResentAccess">J'ai noté l'accès</Button>
      </div>
    </Modal>
  </div>
</template>
