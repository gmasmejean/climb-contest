<script setup lang="ts">
import type { Competition } from '@climbcontest/contracts'
import { Button, DataList, Modal, type DataListColumn } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { competitionsApi } from '../../api/competitions'
import { DESKTOP_QUERY, useMediaQuery } from '../../composables/useMediaQuery'
import {
  DELETE_VERBS,
  RESTORE_VERBS,
  describeBulk,
  runBulk,
  type BulkVerbs,
} from '../../lib/bulk-action'
import { UNREACHABLE_MESSAGE, describeError } from '../../lib/network-errors'
import { describeTrashAge } from '../../lib/trash-age'
import BrandShell from '../../components/brand/BrandShell.vue'

const queryClient = useQueryClient()
const now = new Date()
const isDesktop = useMediaQuery(DESKTOP_QUERY)

const { data, isPending, isError, refetch } = useQuery({
  queryKey: ['competitions', 'trash'],
  queryFn: competitionsApi.listTrash,
})

const selected = ref<string[]>([])
const busy = ref(false)
const bilan = ref<{ text: string; partial: boolean } | null>(null)
// Ce que la modale va supprimer : figé à l'ouverture, pour qu'elle dise vrai.
const toDelete = ref<Competition[]>([])
const confirmOpen = ref(false)

const selectedItems = computed(() =>
  (data.value ?? []).filter((c) => selected.value.includes(c.id)),
)

/**
 * Aucun tri : la corbeille est courte et se lit dans l'ordre où le serveur la
 * rend. C'est la liste des compétitions qu'on trie, pas ce qu'on s'apprête à
 * jeter.
 */
const columns = computed<DataListColumn<Competition>[]>(() => [
  { key: 'name', label: 'Nom', card: 'title', value: (row) => row.name },
  { key: 'venue', label: 'Lieu', card: 'hidden', value: (row) => row.venue },
  { key: 'date', label: 'Début', card: 'hidden', cellClass: 'w-32', value: (row) => row.startsOn },
  { key: 'age', label: 'À la corbeille depuis', card: 'hidden', cellClass: 'w-56' },
  { key: 'actions', label: 'Actions', card: 'actions', labelHidden: true, cellClass: 'w-40' },
])

function toggleSelected(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id]
}

function selectAll(): void {
  selected.value = (data.value ?? []).map((c) => c.id)
}

async function apply(
  items: Competition[],
  action: (c: Competition) => Promise<unknown>,
  verbs: BulkVerbs,
): Promise<void> {
  if (items.length === 0) return
  busy.value = true
  bilan.value = null
  const outcome = await runBulk(items, action, (e) => describeError(e))
  bilan.value = { text: describeBulk(outcome, verbs), partial: outcome.failed.length > 0 }
  // Ce qui a échoué reste sélectionné ; le reste a quitté la corbeille.
  selected.value = outcome.failed.map((failure) => failure.item.id)
  busy.value = false
  if (outcome.done.length > 0) await queryClient.invalidateQueries({ queryKey: ['competitions'] })
}

function restore(items: Competition[]): Promise<void> {
  return apply(items, (c) => competitionsApi.restore(c.id), RESTORE_VERBS)
}

function askDelete(): void {
  toDelete.value = selectedItems.value
  confirmOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const items = toDelete.value
  confirmOpen.value = false
  await apply(items, (c) => competitionsApi.deletePermanently(c.id), DELETE_VERBS)
}

const MAX_NAMES_SHOWN = 5
const namesShown = computed(() => toDelete.value.slice(0, MAX_NAMES_SHOWN))
const namesHidden = computed(() => Math.max(0, toDelete.value.length - MAX_NAMES_SHOWN))
</script>

<template>
  <BrandShell width="wide">
    <main class="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-8 lg:px-8">
      <div class="flex max-w-3xl flex-col gap-6">
        <header class="flex flex-col gap-2">
          <RouterLink
            :to="{ name: 'competition-list' }"
            class="inline-flex min-h-12 items-center text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
          >
            ← Mes compétitions
          </RouterLink>
          <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
            Corbeille
          </h1>
          <p class="text-gray-700">
            Une compétition mise à la corbeille n’apparaît plus nulle part : ni pour vous, ni pour
            les juges, ni pour le public. Vous pouvez la restaurer à tout moment. Tant que vous ne
            la supprimez pas définitivement, rien n’est effacé.
          </p>
        </header>

        <div
          v-if="bilan"
          role="status"
          class="rounded-lg border p-4 text-base"
          :class="
            bilan.partial
              ? 'border-amber-700 bg-amber-50 text-amber-900'
              : 'border-green-700 bg-green-50 text-green-900'
          "
        >
          {{ bilan.text }}
        </div>

        <p v-if="isPending" class="text-gray-600">Chargement…</p>
        <div v-else-if="isError && !data" role="alert" class="flex flex-col items-start gap-3">
          <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
          <Button variant="secondary" @click="() => refetch()">Réessayer</Button>
        </div>
        <p v-else-if="data?.length === 0" class="text-gray-700">La corbeille est vide.</p>

        <template v-else>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-gray-700" aria-live="polite">
              {{ data?.length }} compétition{{ (data?.length ?? 0) > 1 ? 's' : '' }} dans la
              corbeille
            </p>
            <Button variant="secondary" :disabled="busy" @click="selectAll"
              >Tout sélectionner</Button
            >
          </div>

          <DataList
            :rows="data ?? []"
            :columns="columns"
            :layout="isDesktop ? 'table' : 'cards'"
            selectable
            :selected="selected"
            :busy="busy"
            :row-label="(row) => row.name"
            :row-class="(row) => (selected.includes(row.id) ? 'border-blue-700 bg-blue-50' : '')"
            label="Compétitions à la corbeille"
            @update:selected="selected = $event"
          >
            <template #cell-age="{ row }">
              <template v-if="row.deletedAt">{{ describeTrashAge(row.deletedAt, now) }}</template>
              <template v-else-if="isDesktop">—</template>
            </template>

            <template #cell-actions="{ row }">
              <button
                v-if="isDesktop"
                type="button"
                :disabled="busy"
                class="fine:min-h-10 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                @click="restore([row])"
              >
                Restaurer
              </button>
              <Button v-else variant="secondary" :disabled="busy" @click="restore([row])">
                Restaurer
              </Button>
            </template>

            <!--
              La carte de la corbeille enveloppe sa case à cocher dans un
              `<label>` cliquable sur toute sa surface : on garde son markup au
              mot près, le rendu à 360 px ne bouge pas.
            -->
            <template #card="{ row: competition }">
              <div class="flex w-full flex-col gap-3">
                <label class="flex min-h-12 cursor-pointer items-center gap-4">
                  <input
                    type="checkbox"
                    class="size-6 shrink-0 accent-blue-700"
                    :checked="selected.includes(competition.id)"
                    :disabled="busy"
                    @change="toggleSelected(competition.id)"
                  />
                  <span class="flex min-w-0 flex-col">
                    <span class="font-medium text-gray-900">{{ competition.name }}</span>
                    <span class="text-sm text-gray-600"
                      >{{ competition.venue }} — {{ competition.startsOn }}</span
                    >
                    <span v-if="competition.deletedAt" class="text-sm text-gray-700">
                      {{ describeTrashAge(competition.deletedAt, now) }}
                    </span>
                  </span>
                </label>
                <div>
                  <Button variant="secondary" :disabled="busy" @click="restore([competition])">
                    Restaurer
                  </Button>
                </div>
              </div>
            </template>
          </DataList>

          <div
            class="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3"
          >
            <p class="text-base font-medium text-gray-900" aria-live="polite">
              {{ selected.length }} sélectionnée{{ selected.length > 1 ? 's' : '' }}
            </p>
            <div class="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                :disabled="selected.length === 0 || busy"
                @click="restore(selectedItems)"
              >
                Restaurer
              </Button>
              <Button variant="danger" :disabled="selected.length === 0 || busy" @click="askDelete">
                Supprimer définitivement
              </Button>
            </div>
          </div>
        </template>

        <Modal :open="confirmOpen" title="Supprimer définitivement ?" @close="confirmOpen = false">
          <div class="flex flex-col gap-4">
            <p class="text-gray-900">
              {{
                toDelete.length === 1
                  ? 'Cette compétition et toutes ses données seront effacées :'
                  : `Ces ${toDelete.length} compétitions et toutes leurs données seront effacées :`
              }}
            </p>
            <ul class="list-inside list-disc text-gray-900">
              <li v-for="competition in namesShown" :key="competition.id">
                {{ competition.name }}
              </li>
              <li v-if="namesHidden > 0">
                et {{ namesHidden }} autre{{ namesHidden > 1 ? 's' : '' }}
              </li>
            </ul>
            <p class="text-gray-900">
              Compétiteurs, passages, résultats, accès des juges et vidéos.
              <strong>Cette action est irréversible</strong> : vous ne pourrez plus les restaurer.
            </p>
            <div class="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" @click="confirmOpen = false">Annuler</Button>
              <Button variant="danger" @click="confirmDelete">Supprimer définitivement</Button>
            </div>
          </div>
        </Modal>
      </div>
    </main>
  </BrandShell>
</template>
