import type { PDFFont } from 'pdf-lib'

/**
 * Les polices standard de `pdf-lib` (Helvetica…) n'encodent que WinAnsi :
 * un caractère hors de cet ensemble (nom polonais, cyrillique, emoji…) fait
 * LEVER `encodeText`. Un export de résultats ne doit jamais échouer à cause
 * d'un nom — on remplace explicitement par `?` plutôt que de laisser le rendu
 * planter, et on le documente (DECISIONS.md ADR-056).
 */
// Lettres latines étendues sans décomposition Unicode : `NFD` ne les ramène pas
// à leur lettre de base, alors qu'un nom polonais ou croate est courant.
const TRANSLITERATIONS: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Đ: 'D',
  đ: 'd',
  ı: 'i',
  Ħ: 'H',
  ħ: 'h',
}

export function toSupportedText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet())
  const isSupported = (char: string) => {
    const codePoint = char.codePointAt(0)
    return codePoint !== undefined && supported.has(codePoint)
  }

  let result = ''
  for (const char of text.normalize('NFC')) {
    if (isSupported(char)) {
      result += char
      continue
    }
    // Lettre accentuée hors WinAnsi (č, ş, ā…) : on garde la lettre de base
    // plutôt que de perdre toute l'information d'un nom.
    const base = char.normalize('NFD')[0] ?? ''
    const fallback = TRANSLITERATIONS[char] ?? base
    result += fallback !== '' && isSupported(fallback) ? fallback : '?'
  }
  return result
}

/** Retour à la ligne par mots ; un mot plus long que la largeur est coupé caractère par caractère. */
export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = ''
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word
      continue
    }
    let chunk = ''
    for (const char of word) {
      if (chunk && font.widthOfTextAtSize(chunk + char, size) > maxWidth) {
        lines.push(chunk)
        chunk = char
      } else {
        chunk += char
      }
    }
    current = chunk
  }
  if (current) lines.push(current)
  return lines
}
