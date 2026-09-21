<script setup lang="ts">
import { Badge, Button } from '@climbcontest/ui'

import type { JudgeWithRoutes } from '../../api/judges'
import JudgeQrCode from '../../components/JudgeQrCode.vue'

/**
 * Fiche d'un juge à côté de la liste, à partir de 1024 px (ADR-075) : son accès,
 * son QR, son PIN et ses voies d'un coup d'œil. Sous ce seuil, c'est la modale
 * « Voir l'accès » qui reste. Les actions vivent ici et non sur la ligne, pour
 * ne pas les avoir en double (ADR-074 point 2).
 */
const props = defineProps<{
  judge: JudgeWithRoutes
  status: { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
  /** Voies assignées, déjà mises en mots par la liste. */
  routeLabels: string
  lastSeenLabel: string
  /** Lien affichable, ou `null` : voir `lib/judge-access`. */
  accessUrl: string | null
  revoking: boolean
  regenerating: boolean
}>()
const emit = defineEmits<{
  copy: [text: string]
  revoke: []
  'regenerate-pin': []
  close: []
}>()
</script>

<template>
  <section
    class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
    aria-label="Fiche du juge"
    data-testid="judge-card"
  >
    <header class="flex flex-wrap items-start justify-between gap-2">
      <div class="flex flex-col gap-1">
        <h2 class="font-medium text-gray-900">{{ props.judge.displayName }}</h2>
        <div>
          <Badge :tone="props.status.tone">{{ props.status.label }}</Badge>
        </div>
      </div>
      <Button variant="secondary" @click="emit('close')">Fermer</Button>
    </header>

    <dl class="flex flex-col gap-2 text-sm">
      <div class="flex gap-2">
        <dt class="font-medium text-gray-900">Voies&nbsp;:</dt>
        <dd class="text-gray-800">{{ props.routeLabels }}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="font-medium text-gray-900">Code PIN&nbsp;:</dt>
        <dd class="text-gray-800">
          <template v-if="props.judge.pin">{{ props.judge.pin }}</template>
          <template v-else-if="props.judge.hasPin">Demandé, non consultable</template>
          <template v-else>Accès direct — pas de PIN</template>
        </dd>
      </div>
      <div class="flex gap-2">
        <dt class="font-medium text-gray-900">Dernier accès&nbsp;:</dt>
        <dd class="text-gray-800">{{ props.lastSeenLabel }}</dd>
      </div>
    </dl>

    <div v-if="props.accessUrl" class="flex flex-col gap-2">
      <span class="text-sm font-medium text-gray-900">Lien d’accès</span>
      <div class="flex gap-2">
        <input
          readonly
          :value="props.accessUrl"
          aria-label="Lien d’accès du juge"
          class="min-h-12 min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 text-sm"
        />
        <Button variant="secondary" @click="emit('copy', props.accessUrl)">Copier</Button>
      </div>
      <JudgeQrCode :url="props.accessUrl" :judge-name="props.judge.displayName" />
      <p class="text-sm text-gray-600">
        À faire scanner au juge. Le PIN, lui, ne s’écrit jamais dans le QR.
      </p>
    </div>
    <p v-else-if="props.judge.revokedAt" class="text-sm text-gray-700">
      Ce juge est révoqué : son lien ne donne plus accès à la compétition.
    </p>
    <p v-else class="text-sm text-gray-700">
      L’accès de ce juge n’est plus affichable — il n’a été montré qu’une fois (ADR-026). Imprimez
      la planche de QR codes si vous l’avez téléchargée, ou créez-lui un nouvel accès.
    </p>

    <div v-if="!props.judge.revokedAt" class="flex flex-wrap gap-3">
      <Button
        v-if="props.judge.hasPin"
        variant="secondary"
        :disabled="props.regenerating"
        @click="emit('regenerate-pin')"
      >
        Régénérer le PIN
      </Button>
      <Button variant="danger" :disabled="props.revoking" @click="emit('revoke')">Révoquer</Button>
    </div>
  </section>
</template>
