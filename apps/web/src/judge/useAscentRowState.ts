import type { CorrectLastAscentInput, CreateAscentInput } from '@climbcontest/contracts'
import { reactive } from 'vue'

import { correctLastAscent, recordAscent } from './ascent-mutations'

export interface AscentPreview {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf'
  climbTimeMs: number | null
}

export interface AscentRowState {
  status: 'syncing' | 'synced' | 'error'
  preview: AscentPreview
  /** Epoch ms — connu côté client dès la soumission (ADR-007 : recordedAt + 5 min). */
  correctableUntil: number
  retry: () => void
}

/**
 * État optimiste des saisies en cours, par compétiteur — décision confirmée
 * pour ce lot (en ligne uniquement, pas de file durable avant le Lot 6) :
 * en mémoire seulement (module-scope, comme `useToast`), jamais persisté.
 * Un rechargement de page perd cet état non confirmé — c'est le Lot 6 qui
 * apporte la durabilité complète (IndexedDB, retries automatiques).
 *
 * Une ligne n'est JAMAIS retirée de `rows` une fois créée dans la session :
 * la retirer ferait retomber l'écran sur le premier `GET` (potentiellement
 * lancé avant que cette écriture n'ait abouti côté serveur, donc encore
 * « à faire ») plutôt que de garder l'aperçu réellement soumis.
 */
const rows = reactive(new Map<string, AscentRowState>())

/**
 * ADR-007, second volet (« jusqu'à la saisie suivante, n'importe quel
 * compétiteur ») : dès qu'une saisie part pour un AUTRE compétiteur, la
 * fenêtre de correction de la précédente se ferme immédiatement côté
 * affichage — le serveur reste de toute façon seul juge en dernier ressort.
 */
let lastSubmittedCompetitorId: string | null = null

const CORRECTION_WINDOW_MS = 5 * 60 * 1000

function toPreview(input: {
  holdNumber: number | null
  modifier: 'none' | 'plus'
  isTop: boolean
  status: 'valid' | 'dns' | 'dnf'
  climbTimeMs?: number | null | undefined
}): AscentPreview {
  return {
    holdNumber: input.holdNumber,
    modifier: input.modifier,
    isTop: input.isTop,
    status: input.status,
    climbTimeMs: input.climbTimeMs ?? null,
  }
}

function attempt(
  competitorId: string,
  preview: AscentPreview,
  correctableUntil: number,
  send: () => Promise<unknown>,
): void {
  lastSubmittedCompetitorId = competitorId
  rows.set(competitorId, {
    status: 'syncing',
    preview,
    correctableUntil,
    retry: () => attempt(competitorId, preview, correctableUntil, send),
  })
  send()
    .then(() => {
      const current = rows.get(competitorId)
      if (current) rows.set(competitorId, { ...current, status: 'synced' })
    })
    .catch(() => {
      const current = rows.get(competitorId)
      // Reste sous « fait » avec un indicateur d'erreur + réessai — jamais
      // renvoyée vers « à faire » : la renvoyer risquerait une double saisie
      // sur le même compétiteur (heurte l'index unique / le 409 serveur).
      if (current) rows.set(competitorId, { ...current, status: 'error' })
    })
}

export function useAscentRowState(): {
  submitCreate: (competitorId: string, input: CreateAscentInput) => void
  submitCorrect: (
    competitorId: string,
    input: CorrectLastAscentInput,
    originalRecordedAt: string,
  ) => void
  get: (competitorId: string) => AscentRowState | undefined
  canCorrect: (competitorId: string, nowMs: number) => boolean
} {
  function submitCreate(competitorId: string, input: CreateAscentInput): void {
    const correctableUntil = new Date(input.recordedAt).getTime() + CORRECTION_WINDOW_MS
    attempt(competitorId, toPreview(input), correctableUntil, () => recordAscent(input))
  }
  function submitCorrect(
    competitorId: string,
    input: CorrectLastAscentInput,
    originalRecordedAt: string,
  ): void {
    // La correction conserve l'heure d'origine côté serveur (ADR-007) : la
    // fenêtre se calcule depuis cette heure-là, jamais depuis l'instant de
    // la correction elle-même.
    const correctableUntil = new Date(originalRecordedAt).getTime() + CORRECTION_WINDOW_MS
    attempt(competitorId, toPreview(input), correctableUntil, () => correctLastAscent(input))
  }
  function get(competitorId: string): AscentRowState | undefined {
    return rows.get(competitorId)
  }
  function canCorrect(competitorId: string, nowMs: number): boolean {
    const row = rows.get(competitorId)
    if (!row) return false
    return lastSubmittedCompetitorId === competitorId && nowMs < row.correctableUntil
  }
  return { submitCreate, submitCorrect, get, canCorrect }
}
