export interface ResolvedRange {
  start: number
  /** Dernier octet inclus. */
  end: number
}

export type RangeResult =
  { kind: 'none' } | { kind: 'partial'; range: ResolvedRange } | { kind: 'unsatisfiable' }

/**
 * Interprète un en-tête `Range` (RFC 9110 § 14) pour un objet de `size`
 * octets. Un `<video>` demande des plages pour se déplacer dans la vidéo.
 * Plusieurs plages, ou un en-tête mal formé, sont ignorés (la réponse
 * complète reste valable) ; une plage hors de l'objet est « insatisfaisable »
 * (416).
 */
export function parseRange(header: string | undefined | null, size: number): RangeResult {
  if (!header) return { kind: 'none' }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: 'none' }
  const [, rawStart = '', rawEnd = ''] = match

  if (rawStart === '' && rawEnd === '') return { kind: 'none' }

  // « bytes=-N » : les N derniers octets.
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', range: { start: Math.max(0, size - suffix), end: size - 1 } }
  }

  const start = Number(rawStart)
  if (start >= size) return { kind: 'unsatisfiable' }
  const requestedEnd = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (requestedEnd < start) return { kind: 'none' }
  return { kind: 'partial', range: { start, end: Math.min(requestedEnd, size - 1) } }
}
