/**
 * Types de `Tabs`. Hors du composant, comme ceux de `DataList` : un
 * `<script setup>` ne peut rien exporter, et l'appelant doit pouvoir typer la
 * liste d'onglets qu'il construit (`lib/competition-tabs.ts` côté web).
 */

/** Pastille de compte sur un onglet (ROADMAP.md Lot 20). */
export interface TabBadge {
  count: number
  /**
   * Ce que le compte veut dire, en toutes lettres : « 2 conflits ».
   * Il forme le nom accessible du bouton, la pastille elle-même étant
   * `aria-hidden` — voir `Tabs.vue`.
   */
  label: string
  tone?: 'neutral' | 'warning' | 'danger'
}

export interface TabItem {
  id: string
  label: string
  /** Intertitre sous lequel ranger l'onglet ; affiché en orientation verticale seulement. */
  group?: string
  /** Absente = rien à signaler. */
  badge?: TabBadge
}
