import { ROUTE_PHOTO_JPEG_QUALITY, ROUTE_PHOTO_MAX_SIDE } from '@climbcontest/contracts'

/**
 * Taille d'une image ramenée à `maxSide` sur son grand côté, sans jamais
 * l'agrandir. Entiers, au moins 1 pixel. Pure, testée sans navigateur.
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  const scale = longest > maxSide ? maxSide / longest : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Le fichier choisi n'est pas une image que ce navigateur sait lire. */
export class PhotoUnreadableError extends Error {
  constructor() {
    super(
      'Ce fichier n’est pas une photo que le navigateur sait lire. Choisissez une photo JPEG ou PNG (sur iPhone, réglez l’appareil photo sur « Le plus compatible »).',
    )
  }
}

async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  try {
    // `from-image` : applique l'orientation EXIF, sans quoi une photo prise à la
    // verticale s'afficherait couchée.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  } catch {
    // Vieux navigateurs : `createImageBitmap` sans options, ou pas du tout. Un
    // élément <img> applique de lui-même l'orientation EXIF.
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      }
    } catch {
      URL.revokeObjectURL(url)
      throw new PhotoUnreadableError()
    }
  }
}

/**
 * Ré-encode la photo en JPEG, côté long ramené à `ROUTE_PHOTO_MAX_SIDE`
 * (ADR-066) : environ 300 Ko au lieu de plusieurs Mo, orientation appliquée,
 * métadonnées (dont le GPS) retirées, et un seul format à gérer côté serveur et
 * dans le PDF. Nécessite un vrai navigateur (canvas) : vérifié en e2e.
 */
export async function resizeToJpeg(
  file: Blob,
  options: { maxSide?: number; quality?: number } = {},
): Promise<Blob> {
  const { source, width, height, release } = await decode(file)
  try {
    if (width < 1 || height < 1) throw new PhotoUnreadableError()
    const target = fitWithin(width, height, options.maxSide ?? ROUTE_PHOTO_MAX_SIDE)
    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) throw new PhotoUnreadableError()
    // Fond blanc : un PNG transparent deviendrait noir en JPEG.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, target.width, target.height)
    context.drawImage(source, 0, 0, target.width, target.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', options.quality ?? ROUTE_PHOTO_JPEG_QUALITY),
    )
    if (!blob) throw new PhotoUnreadableError()
    return blob
  } finally {
    release()
  }
}
