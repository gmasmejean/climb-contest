<script setup lang="ts">
import { Badge } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'

import { competitionsApi } from '../../../api/competitions'

const props = defineProps<{ competitionId: string }>()

const { data, isPending } = useQuery({
  queryKey: ['competitions', props.competitionId, 'readiness'],
  queryFn: () => competitionsApi.readiness(props.competitionId),
  refetchOnWindowFocus: true,
})

const checkLabels: Record<string, string> = {
  category_without_route: 'Catégories sans aucune voie',
  route_without_category: 'Voies affectées à aucune catégorie',
  competitor_without_bib: 'Compétiteurs sans dossard',
  round_without_route: 'Tours sans aucune voie affectée',
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <template v-else-if="data">
      <p class="flex items-center gap-2 text-lg font-semibold">
        <Badge :tone="data.ready ? 'success' : 'warning'">
          {{ data.ready ? 'Prêt à démarrer' : 'Pas encore prêt' }}
        </Badge>
      </p>

      <ul class="flex flex-col gap-3">
        <li
          v-for="check in data.checks"
          :key="check.id"
          class="rounded-lg border border-gray-200 p-4"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium text-gray-900">{{ checkLabels[check.id] ?? check.id }}</span>
            <Badge :tone="check.ok ? 'success' : 'danger'">
              {{ check.ok ? 'OK' : `${check.items.length} à corriger` }}
            </Badge>
          </div>
          <ul v-if="!check.ok" class="mt-2 list-inside list-disc text-sm text-gray-700">
            <li v-for="item in check.items" :key="item.id">{{ item.label }}</li>
          </ul>
        </li>
      </ul>

      <p class="text-xs text-gray-500">
        L'assignation des juges (Lot 4) ajoutera une condition supplémentaire à ce contrôle.
      </p>
    </template>
  </div>
</template>
