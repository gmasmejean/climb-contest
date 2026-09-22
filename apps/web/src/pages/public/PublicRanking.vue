<script setup lang="ts">
import { Badge } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

import { publicApi, publicQueryKeys } from '../../api/public'
import { formatAscentResult } from '../../lib/format-ascent'

const props = defineProps<{
  slug: string
  categoryId: string
  format: 'contest' | 'phases'
}>()

const { data, isPending, isError } = useQuery({
  queryKey: computed(() => publicQueryKeys.rankings(props.slug, props.categoryId)),
  queryFn: () => publicApi.rankings(props.slug, props.categoryId),
  refetchOnWindowFocus: false,
})

const roundTypeLabels: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}
</script>

<template>
  <section aria-label="Classement">
    <p v-if="isPending" class="text-gray-600">Chargement…</p>
    <p v-else-if="isError" role="alert" class="text-red-700">
      Impossible de charger le classement.
    </p>

    <template v-else-if="data">
      <p v-if="!data.started" class="text-gray-600">
        Le classement n'est pas encore disponible pour cette catégorie.
      </p>
      <template v-else>
        <Badge v-if="data.provisional" tone="warning">Classement provisoire</Badge>
        <p v-if="data.entries.length === 0" class="mt-3 text-gray-600">
          Aucun compétiteur dans cette catégorie.
        </p>
        <ol v-else class="mt-3 flex flex-col gap-2">
          <li
            v-for="entry in data.entries"
            :key="`${entry.rank}-${entry.bib ?? entry.lastName}`"
            class="rounded-lg border border-gray-200 bg-white"
          >
            <details>
              <summary
                class="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                <span class="w-8 shrink-0 text-right text-lg font-bold text-gray-900">{{
                  entry.rank
                }}</span>
                <span class="flex flex-col">
                  <span class="font-medium text-gray-900">{{ entry.firstName }} {{ entry.lastName }}</span>
                  <span class="text-sm text-gray-600">
                    <template v-if="entry.bib">Dossard {{ entry.bib }}</template>
                    <template v-if="entry.club"> — {{ entry.club }}</template>
                  </span>
                </span>
              </summary>
              <div class="flex flex-col gap-3 border-t border-gray-100 px-3 py-3">
                <div v-for="roundDetail in entry.rounds" :key="roundDetail.roundId">
                  <p v-if="format === 'phases'" class="text-sm font-medium text-gray-900">
                    {{ roundTypeLabels[roundDetail.roundType] ?? roundDetail.roundType }}
                  </p>
                  <ul class="flex flex-col gap-1">
                    <li
                      v-for="routeDetail in roundDetail.routes"
                      :key="routeDetail.routeId"
                      class="flex items-center justify-between gap-2 text-sm text-gray-700"
                    >
                      <span
                        >Voie {{ routeDetail.routeNumber }}<template v-if="routeDetail.routeName">
                          — {{ routeDetail.routeName }}</template
                        ></span
                      >
                      <span>{{ formatAscentResult(routeDetail) }} (rang {{ routeDetail.routeRank }})</span>
                    </li>
                  </ul>
                </div>
              </div>
            </details>
          </li>
        </ol>
      </template>
    </template>
  </section>
</template>
