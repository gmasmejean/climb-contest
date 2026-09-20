<script setup lang="ts">
import { Badge } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'

import { roundsApi } from '../../../api/competitions'

// `statusKey` résume l'état de chaque catégorie du tour (ADR-065) : ouvrir ou
// remettre en brouillon une catégorie change sa liste (figée à l'ouverture,
// effacée au retour en brouillon — ADR-054), donc la clé de requête en dépend.
const props = defineProps<{ competitionId: string; roundId: string; statusKey: string }>()

const { data } = useQuery({
  queryKey: computed(() => [
    'competitions',
    props.competitionId,
    'round-qualifiers',
    props.roundId,
    props.statusKey,
  ]),
  queryFn: () => roundsApi.qualifiers(props.competitionId, props.roundId),
})

// Le premier tour d'une catégorie n'a pas de liste figée : on ne montre que
// les catégories qui en ont une.
const categories = computed(() => (data.value?.categories ?? []).filter((c) => c.count > 0))

function formatFrozenAt(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
</script>

<template>
  <section
    v-if="categories.length > 0"
    class="flex flex-col gap-3 border-t border-gray-100 pt-3"
    :data-testid="`round-qualifiers-${roundId}`"
  >
    <h3 class="text-sm font-semibold text-gray-900">Qualifiés de ce tour</h3>
    <details v-for="cat in categories" :key="cat.categoryId" class="rounded-lg border border-gray-200">
      <summary
        class="flex min-h-12 cursor-pointer flex-wrap items-center gap-2 rounded-lg px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        <span class="font-medium text-gray-900">{{ cat.categoryLabel }}</span>
        <span class="text-sm text-gray-700">
          {{ cat.count }} qualifié{{ cat.count > 1 ? 's' : '' }}
        </span>
        <Badge v-if="cat.tiedAtCutoff" tone="warning">
          {{ cat.count }} au lieu de {{ cat.requested }} : égalité
        </Badge>
      </summary>
      <div class="flex flex-col gap-2 border-t border-gray-100 px-3 py-3">
        <p v-if="cat.tiedAtCutoff" class="text-sm text-gray-700">
          Égalité à la limite : tous les ex aequo sont qualifiés (règle fédérale, à confirmer avec
          l’arbitre).
        </p>
        <p v-if="cat.requested === null" class="text-sm text-gray-700">
          Aucun nombre de qualifiés n’est fixé sur le tour précédent : tous les classés passent.
        </p>
        <p v-if="cat.frozenAt" class="text-sm text-gray-600">
          Liste figée le {{ formatFrozenAt(cat.frozenAt) }} — un abandon ou une correction
          ultérieure ne la modifie pas.
        </p>
        <ol class="flex flex-col gap-1 text-sm text-gray-800">
          <li v-for="q in cat.competitors" :key="q.competitorId" class="flex gap-2">
            <span class="w-8 shrink-0 text-right font-semibold">{{ q.sourceRank }}</span>
            <span>
              {{ q.firstName }} {{ q.lastName }}<template v-if="q.bib"> — dossard {{ q.bib }}</template>
            </span>
          </li>
        </ol>
      </div>
    </details>
  </section>
</template>
