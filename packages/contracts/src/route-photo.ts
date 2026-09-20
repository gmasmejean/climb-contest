import { z } from 'zod'

/**
 * Photo annotée d'une voie (Lot 15, ADR-066).
 *
 * La photo est ré-encodée en JPEG dans le navigateur avant l'envoi ; le
 * serveur ne fait confiance ni au type déclaré ni à la taille annoncée.
 */
export const ROUTE_PHOTO_MAX_BYTES = 8 * 1024 * 1024
/** Côté long de la photo après redimensionnement côté client, en pixels. */
export const ROUTE_PHOTO_MAX_SIDE = 1600
export const ROUTE_PHOTO_JPEG_QUALITY = 0.85
/** Plafond de prises annotées sur une photo : bien au-delà de toute voie réelle. */
export const ROUTE_PHOTO_MAX_HOLDS = 500

/**
 * Une prise annotée : son numéro (1 = bas de la voie, SPEC.md § 2) et sa
 * position sur la photo. `x` et `y` sont normalisés dans [0, 1] à partir du
 * coin haut-gauche : indépendants de la résolution, donc valables pour
 * l'écran, le PDF et une photo ré-encodée à une autre taille.
 */
export const routeHoldSchema = z.object({
  number: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})
export type RouteHold = z.infer<typeof routeHoldSchema>

export const routePhotoHoldsSchema = z
  .array(routeHoldSchema)
  .max(ROUTE_PHOTO_MAX_HOLDS)
  .refine((holds) => new Set(holds.map((hold) => hold.number)).size === holds.length, {
    message: 'Deux prises portent le même numéro.',
  })

/** `PUT /competitions/:id/routes/:rid/photo-holds` */
export const routePhotoHoldsInputSchema = z.object({ holds: routePhotoHoldsSchema })
export type RoutePhotoHoldsInput = z.infer<typeof routePhotoHoldsInputSchema>

/** Ce que le juge reçoit à l'amorçage : l'identifiant de l'image et ses prises, pas les octets. */
export const routePhotoSchema = z.object({
  assetId: z.uuid(),
  holds: routePhotoHoldsSchema,
})
export type RoutePhoto = z.infer<typeof routePhotoSchema>

/**
 * Numérote de bas en haut : la prise la plus basse sur la photo (`y` le plus
 * grand, l'axe `y` descend) reçoit 1. À égalité de hauteur, la plus à gauche
 * passe d'abord, pour un résultat déterministe. Ne sait rien du parcours :
 * sur une traversée ou un dévers, c'est à l'organisateur de corriger.
 */
export function renumberByHeight(holds: readonly RouteHold[]): RouteHold[] {
  return [...holds]
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((hold, index) => ({ ...hold, number: index + 1 }))
}

/** Plus petit numéro ≥ 1 encore libre : combler un trou laissé par une suppression. */
export function nextHoldNumber(holds: readonly RouteHold[]): number {
  const used = new Set(holds.map((hold) => hold.number))
  let candidate = 1
  while (used.has(candidate)) candidate += 1
  return candidate
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Ajoute une prise au prochain numéro libre, sa position ramenée dans le cadre de la photo. */
export function addHold(holds: readonly RouteHold[], x: number, y: number): RouteHold[] {
  return [...holds, { number: nextHoldNumber(holds), x: clamp01(x), y: clamp01(y) }]
}

/** Déplace la prise `number` (son numéro ne change pas). Sans effet si elle n'existe pas. */
export function moveHold(
  holds: readonly RouteHold[],
  number: number,
  x: number,
  y: number,
): RouteHold[] {
  return holds.map((hold) =>
    hold.number === number ? { number, x: clamp01(x), y: clamp01(y) } : hold,
  )
}

export function removeHold(holds: readonly RouteHold[], number: number): RouteHold[] {
  return holds.filter((hold) => hold.number !== number)
}

export type ChangeHoldNumberResult =
  { ok: true; holds: RouteHold[] } | { ok: false; reason: 'invalid' | 'taken' }

/**
 * Change le numéro de la prise `from` en `to`. Refuse un numéro déjà porté par
 * une autre prise plutôt que d'en échanger deux en silence : l'organisateur voit
 * le conflit et le tranche lui-même.
 */
export function changeHoldNumber(
  holds: readonly RouteHold[],
  from: number,
  to: number,
): ChangeHoldNumberResult {
  if (!Number.isInteger(to) || to < 1) return { ok: false, reason: 'invalid' }
  if (to === from) return { ok: true, holds: [...holds] }
  if (holds.some((hold) => hold.number === to)) return { ok: false, reason: 'taken' }
  return {
    ok: true,
    holds: holds.map((hold) => (hold.number === from ? { ...hold, number: to } : hold)),
  }
}
