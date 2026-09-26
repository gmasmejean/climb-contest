<script setup lang="ts">
import type {
  AscentMatrixCell,
  AscentMatrixCompetitor,
  AscentMatrixRoute,
  DashboardResponse,
} from '@climbcontest/contracts'
import { Select } from '@climbcontest/ui'
import { useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { roundsApi } from '../../../api/competitions'
import { organizerAscentsApi } from '../../../api/organizer-ascents'
import type { AscentEditTarget } from './ascent-edit'

/**
 * La grille compétiteurs × voies d'un couple (tour, catégorie) — ROADMAP.md
 * Lot 20, point d'API cadré en ADR-083. D'un coup d'œil : qui a grimpé quoi,
 * ce qui manque, et ce qui reste à trancher. Chaque case ouvre la correction
 * ou la saisie de secours.
 *
 * Ne s'affiche qu'à partir de `lg` : en dessous, `PilotageAscents` garde la
 * liste par voie du Lot 8 (ADR-072 point 1, le mobile ne bouge pas).
 */
const props = defineProps<{
  competitionId: string
  categories: DashboardResponse['categories']
}>()

const emit = defineEmits<{ edit: [target: AscentEditTarget]; conflict: [] }>()

const ROUND_TYPE_LABELS: Record<string, string> = {
  qualification: 'Qualification',
  semifinal: 'Demi-finale',
  final: 'Finale',
}

const { data: rounds } = useQuery({
  queryKey: ['competitions', props.competitionId, 'rounds'],
  queryFn: () => roundsApi.list(props.competitionId),
})
const roundLabels = computed(
  () => new Map((rounds.value ?? []).map((r) => [r.id, ROUND_TYPE_LABELS[r.type] ?? 'Tour'])),
)

interface Pair {
  value: string
  label: string
  roundId: string
  categoryId: string
}

/**
 * Couples (tour, catégorie) réellement câblés, dans l'ordre des catégories.
 * Le tour n'entre dans le libellé que s'il y en a plusieurs : en contest il
 * est implicite (ADR-023) et « U16 Femme — Qualification » n'apprendrait rien.
 */
const pairs = computed<Pair[]>(() => {
  const seen = new Map<string, Pair>()
  const roundIds = new Set<string>()
  for (const category of props.categories) {
    for (const route of category.routes) {
      if (route.roundId === null) continue
      roundIds.add(route.roundId)
      const value = `${route.roundId}:${category.categoryId}`
      if (seen.has(value)) continue
      seen.set(value, {
        value,
        label: category.label,
        roundId: route.roundId,
        categoryId: category.categoryId,
      })
    }
  }
  if (roundIds.size <= 1) return [...seen.values()]
  return [...seen.values()].map((pair) => ({
    ...pair,
    label: `${pair.label} — ${roundLabels.value.get(pair.roundId) ?? 'Tour'}`,
  }))
})

/*
 * La sélection vit dans l'adresse, sur le patron d'ADR-075 : recharger la page
 * ne referme pas la grille qu'on regardait, et deux fenêtres côte à côte
 * peuvent suivre deux catégories. `replace` et non `push` — une entrée
 * d'historique par catégorie ferait du bouton « précédent » un désélecteur.
 * Une valeur inconnue retombe silencieusement sur le premier couple.
 */
const urlRoute = useRoute()
const router = useRouter()
const selected = computed<Pair | null>(
  () => pairs.value.find((pair) => pair.value === urlRoute.query.pair) ?? pairs.value[0] ?? null,
)
const selectedValue = computed({
  get: () => selected.value?.value ?? '',
  set: (value: string) => {
    const query = { ...urlRoute.query }
    delete query.pair
    void router.replace({ query: value === '' ? query : { ...query, pair: value } })
  },
})

const { data: matrix, isPending } = useQuery({
  queryKey: computed(() => [
    'competitions',
    props.competitionId,
    'ascents',
    'matrix',
    selected.value?.roundId,
    selected.value?.categoryId,
  ]),
  queryFn: () =>
    organizerAscentsApi.matrix(
      props.competitionId,
      selected.value?.roundId ?? '',
      selected.value?.categoryId ?? '',
    ),
  enabled: computed(() => selected.value !== null),
})

function summarize(cell: AscentMatrixCell): string {
  if (cell.conflict) return 'à trancher'
  if (!cell.ascent) return '—'
  if (cell.ascent.status !== 'valid') return cell.ascent.status.toUpperCase()
  if (cell.ascent.isTop) return 'TOP'
  return `${cell.ascent.holdNumber}${cell.ascent.modifier === 'plus' ? '+' : ''}`
}

function routeLabel(route: AscentMatrixRoute): string {
  return `Voie ${route.number}${route.name ? ` — ${route.name}` : ''}`
}

function competitorLabel(competitor: AscentMatrixCompetitor): string {
  const bib = competitor.bib !== null ? `${competitor.bib} — ` : ''
  return `${bib}${competitor.firstName} ${competitor.lastName}`
}

function cellClass(cell: AscentMatrixCell): string {
  if (cell.conflict) return 'bg-red-100 font-semibold text-red-900 hover:bg-red-200'
  if (cell.ascent) return 'bg-green-50 text-green-900 hover:bg-green-100'
  return 'text-gray-600 hover:bg-gray-100'
}

/**
 * `cells` suit l'ordre de `routes` (l'API les construit ensemble, ADR-083) :
 * on apparie par index plutôt que de chercher un `routeId` pour chaque case
 * d'un tableau qui peut faire 150 lignes.
 */
function openCell(
  competitor: AscentMatrixCompetitor,
  route: AscentMatrixRoute,
  cell: AscentMatrixCell,
): void {
  if (cell.conflict) {
    emit('conflict')
    return
  }
  const roundId = selected.value?.roundId
  if (roundId === undefined) return
  emit('edit', {
    mode: cell.ascent ? 'correct' : 'create',
    subject: `${competitorLabel(competitor)} — ${routeLabel(route)}`,
    roundId,
    routeId: route.routeId,
    competitorId: competitor.competitorId,
    ascentId: cell.ascent?.id ?? null,
    holdNumber: cell.ascent?.holdNumber ?? null,
    modifier: cell.ascent?.modifier ?? 'none',
    isTop: cell.ascent?.isTop ?? false,
    status: cell.ascent?.status ?? 'valid',
    reason: '',
    holdCount: route.holdCount,
  })
}

const headerClass =
  'sticky top-[var(--datalist-top,0px)] z-10 bg-gray-50 px-3 py-2 align-bottom font-medium text-gray-700 shadow-[inset_0_-1px_0_var(--color-gray-200)]'
</script>

<template>
  <div class="flex flex-col gap-4">
    <Select
      v-if="pairs.length > 0"
      v-model="selectedValue"
      label="Catégorie et tour"
      :options="pairs.map((pair) => ({ value: pair.value, label: pair.label }))"
      class="max-w-md"
    />
    <p v-else class="text-gray-600">Aucune voie n'est encore affectée à une catégorie.</p>

    <p v-if="isPending && selected" class="text-gray-600">Chargement…</p>
    <template v-else-if="matrix">
      <p v-if="matrix.competitors.length === 0" class="text-gray-600">
        Aucun compétiteur attendu sur ce tour pour cette catégorie.
      </p>
      <table v-else class="w-full table-fixed text-left text-sm" data-testid="ascent-matrix">
        <caption class="sr-only">
          Passages saisis, par compétiteur et par voie
        </caption>
        <thead>
          <tr>
            <th scope="col" class="w-56" :class="headerClass">Compétiteur</th>
            <th
              v-for="route in matrix.routes"
              :key="route.routeId"
              scope="col"
              :class="headerClass"
            >
              {{ routeLabel(route) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="competitor in matrix.competitors"
            :key="competitor.competitorId"
            class="border-b border-gray-200"
            data-testid="matrix-row"
          >
            <th
              scope="row"
              class="fine:py-1 truncate px-3 py-3 align-middle font-normal text-gray-900"
              :title="competitorLabel(competitor)"
            >
              {{ competitorLabel(competitor) }}
            </th>
            <td
              v-for="(route, index) in matrix.routes"
              :key="route.routeId"
              class="fine:py-1 px-1 py-2"
            >
              <button
                v-if="competitor.cells[index]"
                type="button"
                :data-testid="`matrix-cell-${competitor.competitorId}-${route.routeId}`"
                class="fine:min-h-8 flex min-h-12 w-full items-center justify-center rounded-lg px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                :class="cellClass(competitor.cells[index])"
                :aria-label="`${competitorLabel(competitor)}, ${routeLabel(route)} : ${summarize(competitor.cells[index])}`"
                @click="openCell(competitor, route, competitor.cells[index])"
              >
                {{ summarize(competitor.cells[index]) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
