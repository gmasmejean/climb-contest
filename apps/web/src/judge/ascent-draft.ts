import { ascentShapeFields } from '@climbcontest/contracts'
import { z } from 'zod'

/**
 * Brouillon de la saisie d'un passage (ADR-061). Ce que le juge a composé sur
 * l'écran de saisie mais pas encore confirmé n'existe qu'en mémoire : sans
 * brouillon, un rechargement de page — dont celui d'une mise à jour de
 * l'appli — le perd. La saisie CONFIRMÉE, elle, est déjà durable (file
 * IndexedDB, ADR-012).
 *
 * Un seul emplacement par appareil : un juge ne compose qu'un passage à la fois.
 */

/** Décision du 2026-09-20 (ADR-061) : au-delà, une saisie abandonnée ne revient plus. */
export const DRAFT_MAX_AGE_MS = 10 * 60 * 1000

const STORAGE_KEY = 'climbcontest.judge.ascentDraft'

// Les champs de valeur viennent du contrat (`ascentShapeFields`), pas d'une
// seconde définition. Les règles de forme reprennent celles du contrat, SAUF
// « un passage valide sans TOP doit indiquer une prise » : un brouillon est
// précisément une saisie pas finie.
const draftSchema = z
  .object({
    routeId: z.string().min(1),
    competitorId: z.string().min(1),
    /** `null` en création ; l'`id` du passage corrigé en correction. */
    baseAscentId: z.string().min(1).nullable(),
    /** Millisecondes epoch, horloge de l'appareil. */
    savedAt: z.number().int().nonnegative(),
    holdNumber: ascentShapeFields.holdNumber,
    modifier: ascentShapeFields.modifier,
    isTop: ascentShapeFields.isTop,
    status: ascentShapeFields.status,
    climbTimeMs: ascentShapeFields.climbTimeMs.unwrap(),
  })
  .refine((v) => (v.status !== 'valid' ? v.holdNumber === null && !v.isTop : true))
  .refine((v) => (v.status === 'valid' && v.isTop ? v.holdNumber === null : true))

export type AscentDraft = z.infer<typeof draftSchema>
export type AscentDraftValues = Pick<
  AscentDraft,
  'holdNumber' | 'modifier' | 'isTop' | 'status' | 'climbTimeMs'
>

/** L'écran qui demande un brouillon : ce qu'il montre, pas ce qu'il contient. */
export interface DraftTarget {
  routeId: string
  competitorId: string
  baseAscentId: string | null
  holdCount: number
}

export type DraftVerdict =
  /** Désigne exactement cet écran et n'est pas périmé. */
  | 'usable'
  /** Valide, mais d'un autre passage : à laisser en place. */
  | 'other-screen'
  /** Périmé, ou obsolète pour ce passage : à supprimer. */
  | 'dead'

/** Jamais de « réparation » : un brouillon illisible ou incohérent est ignoré. */
export function parseAscentDraft(raw: string): AscentDraft | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = draftSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function judgeDraft(draft: AscentDraft, target: DraftTarget, nowMs: number): DraftVerdict {
  const ageMs = nowMs - draft.savedAt
  // Un `savedAt` dans le futur (horloge reculée) est traité comme périmé :
  // impossible de savoir depuis quand il dort.
  if (ageMs < 0 || ageMs > DRAFT_MAX_AGE_MS) return 'dead'
  if (draft.routeId !== target.routeId || draft.competitorId !== target.competitorId) {
    return 'other-screen'
  }
  // Même passage mais autre point de départ : la saisie a été confirmée depuis
  // (le passage a un nouvel `id`, ou n'est plus « à faire ») — ce brouillon
  // ferait réapparaître une valeur fantôme.
  if (draft.baseAscentId !== target.baseAscentId) return 'dead'
  if (draft.holdNumber !== null && draft.holdNumber > target.holdCount) return 'dead'
  return 'usable'
}

export function sameDraftValues(a: AscentDraftValues, b: AscentDraftValues): boolean {
  return (
    a.holdNumber === b.holdNumber &&
    a.modifier === b.modifier &&
    a.isTop === b.isTop &&
    a.status === b.status &&
    a.climbTimeMs === b.climbTimeMs
  )
}

// --- Stockage. Même idiome défensif que `useFormDraft.ts` : le brouillon est
// un confort, pas une garantie (contrairement à la file de synchronisation).
// Navigation privée, quota, accès bloqué : on n'écrit rien et on n'échoue pas.

/** Les valeurs à restaurer, ou `null` (rien, périmé, autre écran, illisible). */
export function loadAscentDraft(target: DraftTarget, nowMs: number): AscentDraftValues | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const draft = parseAscentDraft(raw)
    const verdict = draft ? judgeDraft(draft, target, nowMs) : 'dead'
    if (verdict === 'dead') {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    if (verdict === 'other-screen' || !draft) return null
    return {
      holdNumber: draft.holdNumber,
      modifier: draft.modifier,
      isTop: draft.isTop,
      status: draft.status,
      climbTimeMs: draft.climbTimeMs,
    }
  } catch {
    return null
  }
}

export function saveAscentDraft(
  target: DraftTarget,
  values: AscentDraftValues,
  nowMs: number,
): void {
  const draft: AscentDraft = {
    routeId: target.routeId,
    competitorId: target.competitorId,
    baseAscentId: target.baseAscentId,
    savedAt: nowMs,
    ...values,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Rien de plus à faire.
  }
}

/**
 * Efface le brouillon de CE passage — jamais celui d'un autre écran, qui
 * appartient peut-être à une saisie encore en cours.
 */
export function clearAscentDraft(screen: { routeId: string; competitorId: string }): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return
    const draft = parseAscentDraft(raw)
    if (
      !draft ||
      (draft.routeId === screen.routeId && draft.competitorId === screen.competitorId)
    ) {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Rien de plus à faire.
  }
}

/** Changement de juge sur l'appareil (ADR-036) : le brouillon ne lui appartient pas. */
export function purgeAscentDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Rien de plus à faire.
  }
}
