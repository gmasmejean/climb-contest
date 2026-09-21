<script setup lang="ts">
import { Button, NumberField, Select, TextField, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'

import { ApiError } from '../../../api/client'
import { competitorsApi, routesApi } from '../../../api/competitions'
import { conflictsApi } from '../../../api/conflicts'

const props = defineProps<{ competitionId: string }>()

const toast = useToast()
const queryClient = useQueryClient()
const conflictsKey = ['competitions', props.competitionId, 'conflicts']

const { data: conflicts, isPending } = useQuery({
  queryKey: conflictsKey,
  queryFn: () => conflictsApi.list(props.competitionId),
})

// Lot 21 : de QUI et de QUELLE voie parle-t-on ? Indispensable dès qu'il y a
// plusieurs saisies à valider. Mêmes clés de cache que les onglets de préparation.
const { data: competitors } = useQuery({
  queryKey: ['competitions', props.competitionId, 'competitors'],
  queryFn: () => competitorsApi.list(props.competitionId),
})
const { data: routes } = useQuery({
  queryKey: ['competitions', props.competitionId, 'routes'],
  queryFn: () => routesApi.list(props.competitionId),
})
const competitorLabels = computed(
  () =>
    new Map(
      (competitors.value ?? []).map((c) => [
        c.id,
        `${c.bib !== null ? `Dossard ${c.bib} — ` : ''}${c.firstName} ${c.lastName}`,
      ]),
    ),
)
const routeLabels = computed(
  () =>
    new Map(
      (routes.value ?? []).map((r) => [r.id, `Voie ${r.number}${r.name ? ` — ${r.name}` : ''}`]),
    ),
)

async function refresh(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: conflictsKey })
}

function summarize(a: {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
}): string {
  if (a.status === 'dns') return 'DNS'
  if (a.status === 'dnf') return 'DNF'
  if (a.status === 'dsq') return 'DSQ'
  if (a.isTop) return 'TOP'
  return `prise ${a.holdNumber}${a.modifier === 'plus' ? '+' : ''}`
}

const chooseMutation = useMutation({
  mutationFn: (input: { conflictGroup: string; ascentId: string; accepting: boolean }) =>
    conflictsApi.resolve(props.competitionId, input.conflictGroup, {
      resolution: 'choose',
      ascentId: input.ascentId,
    }),
  onSuccess: async (_ascent, input) => {
    await refresh()
    toast.show(
      input.accepting ? 'Saisie acceptée : elle compte au classement.' : 'Conflit résolu.',
      'success',
    )
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Résolution impossible.',
      'error',
    )
  },
})

// Lot 21 (ADR-078) : refuser une saisie reçue d'un accès révoqué — motif obligatoire.
const rejectTargetGroup = ref<string | null>(null)
const rejectReason = ref('')
function startReject(conflictGroup: string): void {
  rejectTargetGroup.value = conflictGroup
  rejectReason.value = ''
}
const rejectMutation = useMutation({
  mutationFn: () =>
    conflictsApi.resolve(props.competitionId, rejectTargetGroup.value ?? '', {
      resolution: 'reject',
      reason: rejectReason.value,
    }),
  onSuccess: async () => {
    rejectTargetGroup.value = null
    await refresh()
    toast.show('Saisie refusée. Elle reste consultable dans le journal.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Refus impossible.',
      'error',
    )
  },
})

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Validé' },
  { value: 'dns', label: 'DNS — absent' },
  { value: 'dnf', label: 'DNF — abandon en cours' },
  { value: 'dsq', label: 'DSQ — disqualifié' },
]
const MODIFIER_OPTIONS = [
  { value: 'none', label: 'Neutre' },
  { value: 'plus', label: '+' },
]

const newValueTargetGroup = ref<string | null>(null)
const newValueForm = reactive<{
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf' | 'dsq'
  reason: string
}>({
  holdNumber: null,
  modifier: 'none',
  isTop: false,
  status: 'valid',
  reason: '',
})
function startNewValue(conflictGroup: string): void {
  newValueTargetGroup.value = conflictGroup
  Object.assign(newValueForm, {
    holdNumber: null,
    modifier: 'none',
    isTop: false,
    status: 'valid',
    reason: '',
  })
}
function cancelNewValue(): void {
  newValueTargetGroup.value = null
}
const newValueMutation = useMutation({
  mutationFn: () =>
    conflictsApi.resolve(props.competitionId, newValueTargetGroup.value ?? '', {
      resolution: 'new_value',
      reason: newValueForm.reason,
      holdNumber: newValueForm.isTop || newValueForm.status !== 'valid' ? null : newValueForm.holdNumber,
      modifier: newValueForm.modifier,
      isTop: newValueForm.status === 'valid' && newValueForm.isTop,
      status: newValueForm.status,
    }),
  onSuccess: async () => {
    newValueTargetGroup.value = null
    await refresh()
    toast.show('Conflit résolu avec une nouvelle valeur.', 'success')
  },
  onError: (error) => {
    toast.show(
      error instanceof ApiError ? (error.detail ?? error.title) : 'Résolution impossible.',
      'error',
    )
  },
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <p v-else-if="conflicts && conflicts.length === 0" class="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900">
      Aucun conflit en attente.
    </p>
    <ul v-else class="flex flex-col gap-4">
      <li
        v-for="conflict in conflicts"
        :key="conflict.conflictGroup"
        class="flex flex-col gap-3 rounded-lg border p-4"
        :class="
          conflict.kind === 'revoked_access'
            ? 'border-amber-300 bg-amber-50'
            : 'border-red-300 bg-red-50'
        "
        :data-testid="`conflict-${conflict.kind}`"
      >
        <p class="font-medium text-gray-900" data-testid="conflict-subject">
          {{ competitorLabels.get(conflict.competitorId) ?? 'Compétiteur' }} —
          {{ routeLabels.get(conflict.routeId) ?? 'voie' }}
        </p>
        <div v-if="conflict.kind === 'revoked_access'" class="flex flex-col gap-1">
          <h3 class="font-bold text-amber-950">Saisie d'un accès révoqué — à valider</h3>
          <p class="text-sm text-amber-950">
            Reçue après la révocation de ce juge. Elle ne compte pas au classement tant que vous ne
            l'avez pas acceptée.
          </p>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div
            v-for="entry in conflict.ascents"
            :key="entry.ascent.id"
            :data-testid="`conflict-ascent-${entry.ascent.id}`"
            class="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-3"
          >
            <span class="font-medium text-gray-900">{{ summarize(entry.ascent) }}</span>
            <span class="text-xs text-gray-600">
              {{ entry.judgeDisplayName ?? 'organisateur' }} — appareil {{ entry.ascent.deviceId }} —
              {{ new Date(entry.ascent.recordedAt).toLocaleTimeString('fr-FR') }}
            </span>
            <Button
              variant="secondary"
              :disabled="chooseMutation.isPending.value"
              @click="
                chooseMutation.mutate({
                  conflictGroup: conflict.conflictGroup,
                  ascentId: entry.ascent.id,
                  accepting: conflict.kind === 'revoked_access',
                })
              "
            >
              {{ conflict.kind === 'revoked_access' ? 'Accepter' : 'Choisir cette valeur' }}
            </Button>
          </div>
        </div>

        <template v-if="conflict.kind === 'revoked_access'">
          <form
            v-if="rejectTargetGroup === conflict.conflictGroup"
            class="flex flex-col gap-3 rounded-lg bg-white p-3"
            @submit.prevent="rejectMutation.mutate()"
          >
            <TextField v-model="rejectReason" label="Motif du refus (obligatoire)" required />
            <div class="flex gap-2">
              <Button
                type="submit"
                variant="danger"
                :disabled="rejectMutation.isPending.value || rejectReason.trim() === ''"
              >
                Refuser cette saisie
              </Button>
              <Button type="button" variant="secondary" @click="rejectTargetGroup = null">
                Annuler
              </Button>
            </div>
          </form>
          <Button v-else variant="secondary" @click="startReject(conflict.conflictGroup)">
            Refuser
          </Button>
        </template>

        <template v-if="newValueTargetGroup === conflict.conflictGroup">
          <form class="flex flex-col gap-3 rounded-lg bg-white p-3" @submit.prevent="newValueMutation.mutate()">
            <Select v-model="newValueForm.status" label="Statut" :options="STATUS_OPTIONS" required />
            <template v-if="newValueForm.status === 'valid'">
              <label class="flex min-h-12 items-center gap-2">
                <input v-model="newValueForm.isTop" type="checkbox" class="h-5 w-5 rounded border-gray-400" />
                <span class="text-sm text-gray-900">TOP</span>
              </label>
              <template v-if="!newValueForm.isTop">
                <NumberField v-model="newValueForm.holdNumber" label="Numéro de prise" :min="1" required />
                <Select v-model="newValueForm.modifier" label="Modificateur" :options="MODIFIER_OPTIONS" />
              </template>
            </template>
            <TextField v-model="newValueForm.reason" label="Motif (obligatoire)" required />
            <div class="flex gap-2">
              <Button type="submit" :disabled="newValueMutation.isPending.value">Valider</Button>
              <Button type="button" variant="secondary" @click="cancelNewValue">Annuler</Button>
            </div>
          </form>
        </template>
        <Button v-else variant="secondary" @click="startNewValue(conflict.conflictGroup)">
          {{
            conflict.kind === 'revoked_access'
              ? 'Saisir une autre valeur'
              : 'Saisir une troisième valeur'
          }}
        </Button>
      </li>
    </ul>
  </div>
</template>
