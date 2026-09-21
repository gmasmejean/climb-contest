<script setup lang="ts">
import { watch } from 'vue'
import { RouterView, useRouter } from 'vue-router'

import { judgeAccessRevoked } from '../../judge/access-state'
import JudgeSyncBanner from '../../judge/JudgeSyncBanner.vue'

// Lot 21 (ADR-078) : la révocation s'apprend en cours de route (réponse du lot
// de saisies, actualisation des voies) — on quitte alors l'écran de saisie.
const router = useRouter()
watch(
  judgeAccessRevoked,
  (revoked) => {
    if (revoked) void router.replace({ name: 'judge-revoked' })
  },
  { immediate: true },
)
</script>

<template>
  <JudgeSyncBanner />
  <RouterView />
</template>
