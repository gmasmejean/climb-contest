<script setup lang="ts" generic="Row extends { id: string }">
import { computed, useId } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

import type { DataListCardRole, DataListColumn, DataListSort, SortDir } from './data-list'

/**
 * Liste de l'espace organisateur (Lot 18, ADR-072/073) : cartes en `layout="cards"`,
 * tableau à en-tête collant en `layout="table"`.
 *
 * UN SEUL des deux arbres est dans le DOM — c'est l'appelant qui choisit, à partir de
 * `useMediaQuery`. Même règle que le `tablist` unique de l'ADR-072 : deux rendus dont
 * un masqué en CSS, ce sont deux arbres d'accessibilité et des boutons en double.
 *
 * Le tri est PILOTÉ : ce composant ne réordonne jamais `rows`, il émet `update:sort`.
 *
 * Densité : les classes `fine:` viennent de la variante `@custom-variant fine` de
 * `apps/web/src/style.css` (ADR-073) et ne compactent QUE le tableau. Ne jamais les
 * porter dans `Button.vue` ni ailleurs : les écrans juge restent à 48 px partout.
 *
 * L'en-tête se colle sous `--datalist-top`, posée par la page (0 par défaut).
 */
const props = withDefaults(
  defineProps<{
    rows: readonly Row[]
    columns: readonly DataListColumn<Row>[]
    /** Nom de la liste : `<caption>` du tableau, lu mais non affiché. */
    label: string
    layout?: 'cards' | 'table'
    sort?: DataListSort | null
    /** Nom accessible d'une ligne : étiquette de sa case à cocher. */
    rowLabel?: ((row: Row) => string) | undefined
    selectable?: boolean
    selected?: readonly string[]
    /** Ligne non cochable (compétition « En cours ») — reste affichée. */
    rowSelectable?: ((row: Row) => boolean) | undefined
    /** Lien porté par la première cellule (jamais par la ligne entière). */
    rowTo?: ((row: Row) => RouteLocationRaw) | undefined
    busy?: boolean
    emptyText?: string | undefined
  }>(),
  {
    layout: 'cards',
    sort: null,
    selectable: false,
    selected: () => [],
    busy: false,
  },
)

const emit = defineEmits<{
  'update:sort': [value: DataListSort]
  'update:selected': [value: string[]]
}>()

defineSlots<
  Record<`cell-${string}`, ((props: { row: Row; index: number }) => unknown) | undefined> & {
    /** Ligne d'ajout rapide, en tête du `<tbody>`. Rendue en tableau SEULEMENT. */
    'quick-add'?: (props: { columnCount: number; headerId: (key: string) => string }) => unknown
    /** Carte entière, quand la composition par rôles ne suffit pas. */
    card?: (props: { row: Row; index: number }) => unknown
    empty?: () => unknown
  }
>()

const uid = useId()
/** Identifiant du `<th>` d'une colonne : `aria-labelledby` des champs d'ajout rapide. */
const headerId = (key: string): string => `${uid}-${key}`

const tableColumns = computed(() => props.columns.filter((column) => column.tableHidden !== true))
const columnCount = computed(() => tableColumns.value.length + (props.selectable ? 1 : 0))

function cardColumns(role: DataListCardRole): DataListColumn<Row>[] {
  return props.columns.filter((column) => (column.card ?? 'subtitle') === role)
}

function isActive(column: DataListColumn<Row>): boolean {
  const sort = props.sort
  return sort !== null && sort.key === column.key
}

function ariaSort(column: DataListColumn<Row>): 'ascending' | 'descending' | 'none' | undefined {
  if (column.compare === undefined) return undefined
  if (!isActive(column)) return 'none'
  return props.sort?.dir === 'asc' ? 'ascending' : 'descending'
}

/** Glyphe décoratif : l'état réel est porté par `aria-sort`. */
function sortGlyph(column: DataListColumn<Row>): string {
  if (!isActive(column)) return '↕'
  return props.sort?.dir === 'asc' ? '↑' : '↓'
}

function toggleSort(column: DataListColumn<Row>): void {
  if (column.compare === undefined) return
  const dir: SortDir = isActive(column) && props.sort?.dir === 'asc' ? 'desc' : 'asc'
  emit('update:sort', { key: column.key, dir })
}

function isSelected(row: Row): boolean {
  return props.selected.includes(row.id)
}

function isDisabled(row: Row): boolean {
  return props.busy || (props.rowSelectable ? !props.rowSelectable(row) : false)
}

function toggleRow(row: Row): void {
  emit(
    'update:selected',
    isSelected(row)
      ? props.selected.filter((value) => value !== row.id)
      : [...props.selected, row.id],
  )
}

/** Texte de repli d'une cellule : vide si la colonne n'a ni `value` ni slot. */
function cellText(column: DataListColumn<Row>, row: Row): string {
  return column.value ? column.value(row) : ''
}
</script>

<template>
  <!-- ============================ Tableau (≥ lg) ============================ -->
  <table v-if="layout === 'table'" class="w-full table-fixed text-left text-sm">
    <caption class="sr-only">
      {{
        label
      }}
    </caption>
    <thead>
      <tr>
        <th
          v-if="selectable"
          scope="col"
          class="sticky top-[var(--datalist-top,0px)] z-10 w-12 bg-gray-50 px-3 py-2 shadow-[inset_0_-1px_0_var(--color-gray-200)]"
        >
          <span class="sr-only">Sélection</span>
        </th>
        <th
          v-for="column in tableColumns"
          :id="headerId(column.key)"
          :key="column.key"
          scope="col"
          :aria-sort="ariaSort(column)"
          class="sticky top-[var(--datalist-top,0px)] z-10 bg-gray-50 px-3 py-2 align-bottom font-medium text-gray-700 shadow-[inset_0_-1px_0_var(--color-gray-200)]"
          :class="column.cellClass"
        >
          <button
            v-if="column.compare"
            type="button"
            class="fine:min-h-10 -mx-2 inline-flex min-h-12 items-center gap-1 rounded px-2 hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            @click="toggleSort(column)"
          >
            <span :class="column.labelHidden ? 'sr-only' : ''">{{ column.label }}</span>
            <span aria-hidden="true" class="text-xs text-gray-600">{{ sortGlyph(column) }}</span>
          </button>
          <span v-else :class="column.labelHidden ? 'sr-only' : ''">{{ column.label }}</span>
        </th>
      </tr>
    </thead>
    <tbody>
      <slot name="quick-add" :column-count="columnCount" :header-id="headerId" />
      <tr
        v-for="(row, index) in rows"
        :key="row.id"
        data-testid="data-list-row"
        class="border-b border-gray-200 hover:bg-gray-50"
        :class="selectable && isSelected(row) ? 'bg-blue-50' : ''"
      >
        <td v-if="selectable" class="fine:py-1.5 px-3 py-3">
          <input
            type="checkbox"
            class="fine:size-5 size-6 shrink-0 accent-blue-700"
            :checked="isSelected(row)"
            :disabled="isDisabled(row)"
            :aria-label="rowLabel ? rowLabel(row) : undefined"
            @change="toggleRow(row)"
          />
        </td>
        <component
          :is="columnIndex === 0 ? 'th' : 'td'"
          v-for="(column, columnIndex) in tableColumns"
          :key="column.key"
          :scope="columnIndex === 0 ? 'row' : undefined"
          :title="column.value ? cellText(column, row) : undefined"
          class="fine:py-1.5 truncate px-3 py-3 align-middle font-normal"
          :class="column.cellClass"
        >
          <slot :name="`cell-${column.key}`" :row="row" :index="index">
            <RouterLink
              v-if="columnIndex === 0 && rowTo"
              :to="rowTo(row)"
              class="font-medium text-gray-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              {{ cellText(column, row) }}
            </RouterLink>
            <template v-else>{{ cellText(column, row) }}</template>
          </slot>
        </component>
      </tr>
      <tr v-if="rows.length === 0">
        <td :colspan="columnCount" class="px-3 py-6 text-gray-600">
          <slot name="empty">{{ emptyText }}</slot>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- ============================ Cartes (< lg) ============================ -->
  <ul v-else class="flex flex-col gap-2">
    <li
      v-for="(row, index) in rows"
      :key="row.id"
      data-testid="data-list-row"
      class="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <slot name="card" :row="row" :index="index">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <template v-for="column in cardColumns('title')" :key="column.key">
              <slot :name="`cell-${column.key}`" :row="row" :index="index">
                <span class="font-medium text-gray-900">{{ cellText(column, row) }}</span>
              </slot>
            </template>
            <template v-for="column in cardColumns('aside')" :key="column.key">
              <slot :name="`cell-${column.key}`" :row="row" :index="index">
                {{ cellText(column, row) }}
              </slot>
            </template>
          </div>
          <p class="text-sm text-gray-600">
            <template v-for="(column, position) in cardColumns('subtitle')" :key="column.key">
              <span v-if="position > 0" aria-hidden="true"> · </span>
              <slot :name="`cell-${column.key}`" :row="row" :index="index">
                {{ cellText(column, row) }}
              </slot>
            </template>
          </p>
        </div>
        <div v-if="cardColumns('actions').length > 0" class="flex flex-wrap items-center gap-2">
          <template v-for="column in cardColumns('actions')" :key="column.key">
            <slot :name="`cell-${column.key}`" :row="row" :index="index">
              {{ cellText(column, row) }}
            </slot>
          </template>
        </div>
      </slot>
    </li>
    <li v-if="rows.length === 0" class="text-gray-600">
      <slot name="empty">{{ emptyText }}</slot>
    </li>
  </ul>
</template>
