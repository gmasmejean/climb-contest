import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { toSupportedText, wrapText } from './pdf-text'

async function helvetica() {
  const pdf = await PDFDocument.create()
  return pdf.embedFont(StandardFonts.Helvetica)
}

describe('toSupportedText', () => {
  it('garde les accents français et les guillemets typographiques', async () => {
    const font = await helvetica()
    expect(toSupportedText(font, 'Zoé Lefèvre — « Œuf » d’été')).toBe('Zoé Lefèvre — « Œuf » d’été')
  })

  it('ramène une lettre latine étendue à sa lettre de base', async () => {
    const font = await helvetica()
    expect(toSupportedText(font, 'Łukasz Đorđević Ştefan Čech')).toBe('Lukasz Dordevic Stefan Cech')
  })

  it('remplace ce qui n’a aucun équivalent par « ? », sans jamais lever', async () => {
    const font = await helvetica()
    expect(toSupportedText(font, 'Клуб 日本 🧗')).toBe('???? ?? ?')
  })

  it('normalise une lettre accentuée écrite en deux points de code', async () => {
    const font = await helvetica()
    expect(toSupportedText(font, 'Zoé')).toBe('Zoé')
  })
})

describe('wrapText', () => {
  it('coupe entre les mots sans dépasser la largeur', async () => {
    const font = await helvetica()
    const lines = wrapText(font, 'un deux trois quatre cinq six sept huit', 10, 60)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(60)
    expect(lines.join(' ')).toBe('un deux trois quatre cinq six sept huit')
  })

  it('coupe un mot plus long que la largeur, caractère par caractère', async () => {
    const font = await helvetica()
    const lines = wrapText(font, 'A'.repeat(100), 10, 50)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(50)
    expect(lines.join('')).toBe('A'.repeat(100))
  })

  it('renvoie une ligne vide pour un texte vide', async () => {
    const font = await helvetica()
    expect(wrapText(font, '', 10, 50)).toEqual([])
  })
})
