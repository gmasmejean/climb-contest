/**
 * Zone à garder d'une photo (ADR-067), en coordonnées normalisées dans [0, 1] de
 * l'image ORIENTÉE (celle que voit l'organisateur, EXIF appliqué) : indépendante
 * de la résolution, donc de l'affichage comme du fichier d'origine. Fonctions
 * pures, testées sans navigateur.
 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export type CropCorner = 'nw' | 'ne' | 'sw' | 'se'

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 }

/** Côté minimal de la zone (10 % de la photo) : en dessous, plus rien à lire. */
export const MIN_CROP_SIDE = 0.1

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** La zone couvre toute la photo : rien à recadrer. */
export function isFullCrop(crop: CropRect): boolean {
  const epsilon = 0.001
  return (
    crop.x <= epsilon &&
    crop.y <= epsilon &&
    crop.width >= 1 - epsilon &&
    crop.height >= 1 - epsilon
  )
}

/** Déplace la zone sans la redimensionner ; elle s'arrête au bord de la photo. */
export function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  }
}

/**
 * Déplace un coin de la zone ; le coin opposé reste fixe. Le coin ne sort pas
 * de la photo et ne rapproche pas les deux bords de moins de `MIN_CROP_SIDE`.
 */
export function resizeCrop(crop: CropRect, corner: CropCorner, dx: number, dy: number): CropRect {
  let left = crop.x
  let top = crop.y
  let right = crop.x + crop.width
  let bottom = crop.y + crop.height
  if (corner === 'nw' || corner === 'sw') left = clamp(left + dx, 0, right - MIN_CROP_SIDE)
  else right = clamp(right + dx, left + MIN_CROP_SIDE, 1)
  if (corner === 'nw' || corner === 'ne') top = clamp(top + dy, 0, bottom - MIN_CROP_SIDE)
  else bottom = clamp(bottom + dy, top + MIN_CROP_SIDE, 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * La zone en pixels entiers d'une image de `width` × `height`, toujours contenue
 * dans l'image et d'au moins 1 pixel : c'est ce que `drawImage` reçoit.
 */
export function cropToPixels(
  crop: CropRect,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = clamp(Math.round(crop.x * width), 0, width - 1)
  const sy = clamp(Math.round(crop.y * height), 0, height - 1)
  const right = clamp(Math.round((crop.x + crop.width) * width), sx + 1, width)
  const bottom = clamp(Math.round((crop.y + crop.height) * height), sy + 1, height)
  return { sx, sy, sw: right - sx, sh: bottom - sy }
}

/** Photo choisie par l'organisateur et zone à garder (`null` : la photo entière). */
export interface PickedPhoto {
  file: File
  crop: CropRect | null
}
