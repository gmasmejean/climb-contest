/**
 * Types de `DataList` (Lot 18, ADR-072/073).
 *
 * Une colonne se décrit UNE fois et sert aux deux rendus : le tableau dense des
 * grands écrans et les cartes des petits. Ces types vivent hors du composant
 * parce qu'un `<script setup>` ne peut rien exporter.
 */

/** Sens de tri. Même vocabulaire que `competition-list-view.ts` (Lot 11). */
export type SortDir = 'asc' | 'desc'

/** Colonne triée et sens. `null` = l'ordre reçu (ordre métier, ou tri par défaut). */
export interface DataListSort {
  key: string
  dir: SortDir
}

/**
 * Place de la colonne dans le rendu en cartes :
 * `title` première ligne, `subtitle` seconde ligne en gris (jointes par « · »),
 * `aside` pastille à côté du titre, `actions` boutons, `hidden` tableau seulement.
 */
export type DataListCardRole = 'title' | 'subtitle' | 'aside' | 'actions' | 'hidden'

export interface DataListColumn<Row> {
  /** Identifiant : nom du slot (`cell-<key>`), clé de tri, identifiant de l'en-tête. */
  key: string
  /** En-tête de colonne. Sert d'étiquette accessible aux champs d'ajout rapide. */
  label: string
  /** Texte de la cellule quand aucun slot ne la prend en charge. */
  value?: ((row: Row) => string) | undefined
  /** Comparateur croissant. Présent = colonne triable (en-tête bouton + `aria-sort`). */
  compare?: ((a: Row, b: Row) => number) | undefined
  /** Valeur absente (dossard non attribué…) : reste en bas dans les DEUX sens. */
  missing?: ((row: Row) => boolean) | undefined
  /** Défaut : `'subtitle'`. */
  card?: DataListCardRole | undefined
  /** Colonne absente du tableau (information qui n'a de sens qu'en carte). */
  tableHidden?: boolean | undefined
  /** Largeur et alignement, appliqués à l'en-tête comme aux cellules. */
  cellClass?: string | undefined
  /** En-tête lu par les lecteurs d'écran mais non affiché (colonne d'actions). */
  labelHidden?: boolean | undefined
}
