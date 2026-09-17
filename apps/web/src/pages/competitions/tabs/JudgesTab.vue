<script setup lang="ts">
import {
  createJudgeInputSchema,
  type Competition,
  type JudgeCreated,
} from '@climbcontest/contracts'
import { Badge, Button, Modal, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { competitionsApi, routesApi } from '../../../api/competitions'
import { judgesApi, revealedJudgeTokens, type JudgeWithRoutes } from '../../../api/judges'

const props = defineProps<{ competition: Competition }>()

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

const pinRequiredMutation = useMutation({
  mutationFn: (judgePinRequired: boolean) =>
    competitionsApi.update(props.competition.id, { judgePinRequired }),
  onSuccess: async (updated) => {
    queryClient.setQueryData(['competitions', props.competition.id], updated)
    await queryClient.invalidateQueries({ queryKey: ['competitions'] })
  },
})
function togglePinRequired(event: Event): void {
  pinRequiredMutation.mutate((event.target as HTMLInputElement).checked)
}

function emptyForm() {
  return { displayName: '', routeIds: [] as string[] }
}
const form = reactive(emptyForm())
const formError = ref('')

const createMutation = useMutation({
  mutationFn: () => judgesApi.create(props.competition.id, { ...form }),
  onSuccess: async (created) => {
    Object.assign(form, emptyForm())
    revealedJudge.value = created
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
  const result = createJudgeInputSchema.safeParse({ ...form })
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

const downloadableJudges = computed(() =>
  revealedJudgeTokens.value.filter(
    (entry) =>
      entry.competitionId === props.competition.id &&
      judges.value?.some((j) => j.id === entry.judgeId && !j.revokedAt),
  ),
)
const isDownloading = ref(false)
async function downloadQrSheet(): Promise<void> {
  isDownloading.value = true
  try {
    const blob = await judgesApi.downloadQrSheet(
      props.competition.id,
      downloadableJudges.value.map(({ judgeId, accessToken: token }) => ({
        judgeId,
        accessToken: token,
      })),
    )
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
</script>

<template>
  <div class="flex flex-col gap-6">
    <label class="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-4">
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

    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="j in judges"
        :key="j.id"
        class="flex flex-col gap-2 rounded-lg border border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-gray-900">{{ j.displayName }}</span>
            <Badge :tone="judgeStatus(j).tone">{{ judgeStatus(j).label }}</Badge>
            <Badge v-if="!j.hasPin" tone="neutral">Accès direct — pas de PIN</Badge>
          </div>
          <p class="text-sm text-gray-600">{{ routeLabels(j.routeIds) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <Button
            v-if="j.hasPin && !j.revokedAt"
            variant="secondary"
            :disabled="regenerateMutation.isPending.value"
            @click="regenerateMutation.mutate(j.id)"
          >
            Régénérer le PIN
          </Button>
          <Button
            v-if="!j.revokedAt"
            variant="danger"
            :disabled="revokeMutation.isPending.value"
            @click="revokeMutation.mutate(j.id)"
          >
            Révoquer
          </Button>
        </div>
      </li>
      <li v-if="judges && judges.length === 0" class="text-gray-600">Aucun juge.</li>
    </ul>

    <Button variant="secondary" :disabled="isDownloading" @click="downloadQrSheet">
      {{ isDownloading ? 'Génération…' : 'Planche de QR codes (PDF)' }}
    </Button>
    <p v-if="downloadableJudges.length < (judges?.length ?? 0)" class="text-xs text-gray-500">
      La planche n'inclut que les juges créés lors de cette session (le lien en clair n'est jamais
      conservé) — les juges d'une session précédente figurent uniquement via la page QR publique de
      la compétition.
    </p>

    <form
      class="flex flex-col gap-4 rounded-lg border border-gray-200 p-4"
      @submit.prevent="onSubmit"
    >
      <h2 class="font-medium text-gray-900">Ajouter un juge</h2>
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium text-gray-900">Nom affiché</span>
        <input
          v-model="form.displayName"
          type="text"
          class="min-h-12 rounded-lg border border-gray-400 px-3 text-base"
          required
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
        <p class="text-sm text-red-700">
          {{
            revealedJudge.pin
              ? 'Ce lien et ce PIN ne seront plus jamais affichés.'
              : 'Ce lien ne sera plus jamais affiché.'
          }}
          Notez-le{{ revealedJudge.pin ? 's' : '' }} ou imprimez la planche maintenant.
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

    <Modal
      :open="regeneratedPin !== null"
      title="Nouveau PIN — à noter maintenant"
      @close="closeRegenerated"
    >
      <div v-if="regeneratedPin" class="flex flex-col gap-4">
        <p class="text-sm text-red-700">
          Ce PIN ne sera plus jamais affiché — communiquez-le à {{ regeneratedPin.displayName }}
          maintenant.
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
