import type { Competition } from '@climbcontest/contracts'

/**
 * Recherche, filtres et tri de la liste des compétitions (Lot 11, ADR-062).
 * Tout se fait dans le navigateur, sur la liste que l'API renvoie déjà en
 * entier : aucune requête à chaque frappe. Fonctions pures — la date du jour
 * est un paramètre, jamais lue ici.
 */

export type CompetitionStatus = Competition['status']

/** Cycle de vie : c'est l'ordre du tri par statut, pas l'ordre alphabétique. */
export const STATUS_ORDER: readonly CompetitionStatus[] = [
  'draft',
  'open',
  'running',
  'closed',
  'archived',
]

export const SORT_KEYS = ['date', 'name', 'status'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type SortDir = 'asc' | 'desc'

/**
 * « À venir » : pas encore terminée (une compétition en cours en fait partie).
 * « Passées » : terminée avant aujourd'hui. Les deux se partagent la liste
 * sans trou ni doublon.
 */
export type When = 'upcoming' | 'past'

export interface ListView {
  /** Texte libre, cherché dans le nom et le lieu. */
  q: string
  /** Statuts gardés ; vide = aucun filtre (tout est visible). */
  statuses: readonly CompetitionStatus[]
  /** Bornes incluses, sur la date de DÉBUT (`YYYY-MM-DD`), '' = sans borne. */
  from: string
  to: string
  when: When | null
  sort: SortKey
  dir: SortDir
}

export type ListedCompetition = Pick<
  Competition,
  'id' | 'name' | 'venue' | 'status' | 'startsOn' | 'endsOn'
>

export const DEFAULT_LIST_VIEW: ListView = {
  q: '',
  statuses: [],
  from: '',
  to: '',
  when: null,
  sort: 'date',
  dir: 'desc',
}

/**
 * `YYYY-MM-DD` du jour LOCAL. `toISOString()` donnerait la date UTC : à 0 h 30
 * heure de Paris, « aujourd'hui » serait encore hier.
 */
export function toLocalDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Minuscules, sans accents, sans espaces aux extrémités. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' })
}

function matchesSearch(row: ListedCompetition, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true
  const haystack = normalize(`${row.name} ${row.venue}`)
  return tokens.every((token) => haystack.includes(token))
}

function matchesDates(row: ListedCompetition, view: ListView, today: string): boolean {
  if (view.from !== '' && row.startsOn < view.from) return false
  if (view.to !== '' && row.startsOn > view.to) return false
  if (view.when === 'upcoming' && row.endsOn < today) return false
  if (view.when === 'past' && row.endsOn >= today) return false
  return true
}

function compareBySort(a: ListedCompetition, b: ListedCompetition, view: ListView): number {
  let primary = 0
  if (view.sort === 'date') primary = a.startsOn.localeCompare(b.startsOn)
  else if (view.sort === 'name') primary = compareText(a.name, b.name)
  else primary = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  return view.dir === 'asc' ? primary : -primary
}

/** Départage stable, indépendant du sens : plus récente d'abord, puis nom, puis identifiant. */
function compareTieBreak(a: ListedCompetition, b: ListedCompetition): number {
  return (
    b.startsOn.localeCompare(a.startsOn) || compareText(a.name, b.name) || a.id.localeCompare(b.id)
  )
}

export function applyListView<T extends ListedCompetition>(
  rows: readonly T[],
  view: ListView,
  today: string,
): T[] {
  const query = normalize(view.q)
  const tokens = query === '' ? [] : query.split(/\s+/)
  return rows
    .filter(
      (row) =>
        matchesSearch(row, tokens) &&
        (view.statuses.length === 0 || view.statuses.includes(row.status)) &&
        matchesDates(row, view, today),
    )
    .sort((a, b) => compareBySort(a, b, view) || compareTieBreak(a, b))
}

export function isDefaultListView(view: ListView): boolean {
  return (
    view.q === '' &&
    view.statuses.length === 0 &&
    view.from === '' &&
    view.to === '' &&
    view.when === null &&
    view.sort === DEFAULT_LIST_VIEW.sort &&
    view.dir === DEFAULT_LIST_VIEW.dir
  )
}

// --- Adresse de la page (?q=&status=&from=&to=&when=&sort=&dir=) ---

type QueryValue = string | null | undefined | readonly (string | null)[]
export type ListViewQuery = Record<string, QueryValue>

function first(value: QueryValue): string {
  const single = typeof value === 'string' || value == null ? value : value[0]
  return typeof single === 'string' ? single : ''
}

function validDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? '' : value
}

/** Une adresse modifiée à la main ne doit jamais casser la page : le invalide est ignoré. */
export function parseListView(query: ListViewQuery): ListView {
  const wanted = new Set(first(query.status).split(','))
  const sort = SORT_KEYS.find((key) => key === first(query.sort)) ?? DEFAULT_LIST_VIEW.sort
  const dir: SortDir =
    first(query.dir) === 'asc'
      ? 'asc'
      : first(query.dir) === 'desc'
        ? 'desc'
        : DEFAULT_LIST_VIEW.dir
  const whenRaw = first(query.when)
  return {
    q: first(query.q),
    statuses: STATUS_ORDER.filter((status) => wanted.has(status)),
    from: validDay(first(query.from)),
    to: validDay(first(query.to)),
    when: whenRaw === 'upcoming' || whenRaw === 'past' ? whenRaw : null,
    sort,
    dir,
  }
}

/** N'écrit dans l'adresse que ce qui s'écarte de la vue par défaut. */
export function serializeListView(view: ListView): Record<string, string> {
  const query: Record<string, string> = {}
  if (view.q !== '') query.q = view.q
  if (view.statuses.length > 0) query.status = view.statuses.join(',')
  if (view.from !== '') query.from = view.from
  if (view.to !== '') query.to = view.to
  if (view.when !== null) query.when = view.when
  if (view.sort !== DEFAULT_LIST_VIEW.sort) query.sort = view.sort
  if (view.dir !== DEFAULT_LIST_VIEW.dir) query.dir = view.dir
  return query
}
