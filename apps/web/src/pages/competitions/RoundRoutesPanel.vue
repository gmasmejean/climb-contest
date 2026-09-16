<script setup lang="ts">
import { Button, useToast } from '@climbcontest/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ref, watch } from 'vue'

import { roundsApi } from '../../api/competitions'

const props = defineProps<{
  competitionId: string
  roundId: string
  pairs: Array<{ routeId: string; categoryId: string; label: string }>
}>()

const toast = useToast()
const queryClient = useQueryClient()
const queryKey = ['competitions', props.competitionId, 'rounds', props.roundId, 'routes']

const { data: current } = useQuery({
  queryKey,
  queryFn: () => roundsApi.getRoutes(props.competitionId, props.roundId),
})

const selected = ref<Set<string>>(new Set())
function pairKey(routeId: string, categoryId: string): string {
  return `${routeId}::${categoryId}`
}
watch(
  current,
  (value) => {
    if (value) selected.value = new Set(value.map((a) => pairKey(a.routeId, a.categoryId)))
  },
  { immediate: true },
)

const { mutate: save, isPending: isSaving } = useMutation({
  mutationFn: () =>
    roundsApi.setRoutes(
      props.competitionId,
      props.roundId,
      props.pairs
        .filter((pair) => selected.value.has(pairKey(pair.routeId, pair.categoryId)))
        .map(({ routeId, categoryId }) => ({ routeId, categoryId })),
    ),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey })
    await queryClient.invalidateQueries({
      queryKey: ['competitions', props.competitionId, 'readiness'],
    })
    toast.show('Voies du tour mises à jour.', 'success')
  },
})
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-gray-100 pt-3">
    <p v-if="pairs.length === 0" class="text-sm text-gray-600">
      Aucune voie affectée à une catégorie pour l'instant — faites-le depuis l'onglet Voies.
    </p>
    <label
      v-for="pair in pairs"
      :key="pairKey(pair.routeId, pair.categoryId)"
      class="flex min-h-12 items-center gap-2 text-sm"
    >
      <input
        type="checkbox"
        class="h-5 w-5 rounded border-gray-400"
        :checked="selected.has(pairKey(pair.routeId, pair.categoryId))"
        @change="
          ($event.target as HTMLInputElement).checked
            ? selected.add(pairKey(pair.routeId, pair.categoryId))
            : selected.delete(pairKey(pair.routeId, pair.categoryId))
        "
      />
      {{ pair.label }}
    </label>
    <Button variant="secondary" class="self-start" :disabled="isSaving" @click="save()">
      {{ isSaving ? 'Enregistrement…' : 'Enregistrer les voies du tour' }}
    </Button>
  </div>
</template>
