import type { VideoMimeType } from '@climbcontest/contracts'

/** Nombre d'octets à lire pour reconnaître un conteneur. */
export const SNIFF_BYTES = 64

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length))

// Marques ISO-BMFF de vraies vidéos MP4. `heic`, `avif`, `mif1`… sont des
// images qui partagent le même conteneur : volontairement absentes.
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4VH',
  'dash',
  'MSNV',
])

/**
 * Reconnaît le conteneur d'après le CONTENU du fichier, jamais d'après son
 * extension ni le type déclaré par le client (ADR-058). `null` si ce n'est
 * pas un conteneur accepté. Le codec n'est pas vérifié (ADR-052).
 */
export function sniffVideoType(head: Uint8Array): VideoMimeType | null {
  // ISO base media (MP4 / QuickTime) : taille sur 4 octets, puis « ftyp »,
  // puis la marque principale.
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4)
    if (brand === 'qt  ') return 'video/quicktime'
    return MP4_BRANDS.has(brand) ? 'video/mp4' : null
  }

  // EBML (Matroska/WebM) : 1A 45 DF A3, puis le DocType. Un .mkv porte le même
  // en-tête que WebM — on exige le DocType « webm ».
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return ascii(head, 0, head.length).includes('webm') ? 'video/webm' : null
  }

  return null
}
