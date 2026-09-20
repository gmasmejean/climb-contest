import type { RouteHold } from '@climbcontest/contracts'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { toSupportedText, wrapText } from './exports/pdf-text'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const MARGIN = 36
const HEADER_HEIGHT = 92
const FOOTER_HEIGHT = 28
const RING_RADIUS = 7
const LABEL_SIZE = 11

export interface RouteSheetInput {
  number: number
  name: string | null
  sector: string | null
  color: string | null
  holdCount: number
  categoryLabels: string[]
  photoJpeg: Uint8Array
  holds: RouteHold[]
}

export interface RouteSheetsInput {
  competitionName: string
  sheets: RouteSheetInput[]
}

/**
 * Fiches « voie » (ROADMAP.md Lot 15, ADR-066) : une page A4 par voie, avec
 * l'identité de la voie et sa photo annotée. Les prises sont un anneau sur la
 * prise, numéro dans une pastille blanche à côté — l'anneau ne recouvre pas la
 * prise elle-même, et la fiche reste lisible imprimée en noir et blanc.
 * Polices standard (ADR-057) : tout texte saisi passe par `toSupportedText`.
 */
export async function generateRouteSheets(input: RouteSheetsInput): Promise<Uint8Array> {
  if (input.sheets.length === 0) {
    throw new Error('Aucune fiche à produire : au moins une voie avec photo est nécessaire.')
  }
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)

  for (const sheet of input.sheets) {
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    await drawSheet(pdf, page, sheet, input.competitionName, font, boldFont)
  }
  return pdf.save()
}

async function drawSheet(
  pdf: PDFDocument,
  page: PDFPage,
  sheet: RouteSheetInput,
  competitionName: string,
  font: PDFFont,
  boldFont: PDFFont,
): Promise<void> {
  const contentWidth = A4_WIDTH - MARGIN * 2
  const text = (value: string) => toSupportedText(font, value)

  const title = sheet.name ? `Voie ${sheet.number} — ${sheet.name}` : `Voie ${sheet.number}`
  let cursorY = A4_HEIGHT - MARGIN - 20
  for (const line of wrapText(boldFont, text(title), 22, contentWidth).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: cursorY, size: 22, font: boldFont })
    cursorY -= 26
  }

  const details = [
    `${sheet.holdCount} prises`,
    sheet.sector ? `Secteur : ${sheet.sector}` : null,
    sheet.color ? `Couleur : ${sheet.color}` : null,
    sheet.categoryLabels.length > 0 ? sheet.categoryLabels.join(', ') : null,
  ]
    .filter((part): part is string => part !== null)
    .join('  ·  ')
  for (const line of wrapText(font, text(details), 11, contentWidth).slice(0, 2)) {
    page.drawText(line, { x: MARGIN, y: cursorY, size: 11, font, color: rgb(0.25, 0.25, 0.25) })
    cursorY -= 14
  }

  // Zone de la photo : tout ce qui reste entre l'en-tête et le pied de page.
  const areaTop = A4_HEIGHT - MARGIN - HEADER_HEIGHT
  const areaBottom = MARGIN + FOOTER_HEIGHT
  const areaHeight = areaTop - areaBottom
  const image = await pdf.embedJpg(sheet.photoJpeg)
  const scale = Math.min(contentWidth / image.width, areaHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale
  const left = MARGIN + (contentWidth - width) / 2
  const bottom = areaTop - height
  page.drawImage(image, { x: left, y: bottom, width, height })
  page.drawRectangle({
    x: left,
    y: bottom,
    width,
    height,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.75,
  })

  for (const hold of sheet.holds) {
    const cx = left + hold.x * width
    const cy = bottom + (1 - hold.y) * height
    drawHold(page, hold.number, { cx, cy }, { left, right: left + width }, boldFont)
  }

  const placed = sheet.holds.length
  const footer =
    placed === 0
      ? 'Aucune prise annotée sur cette photo.'
      : `${placed} prise${placed > 1 ? 's' : ''} annotée${placed > 1 ? 's' : ''} sur ${sheet.holdCount}`
  page.drawText(text(footer), {
    x: MARGIN,
    y: MARGIN + 6,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  })
  const competitionLabel = text(competitionName)
  page.drawText(competitionLabel, {
    x: A4_WIDTH - MARGIN - font.widthOfTextAtSize(competitionLabel, 9),
    y: MARGIN + 6,
    size: 9,
    font,
    color: rgb(0.35, 0.35, 0.35),
  })
}

function drawHold(
  page: PDFPage,
  number: number,
  center: { cx: number; cy: number },
  bounds: { left: number; right: number },
  boldFont: PDFFont,
): void {
  const { cx, cy } = center
  // Anneau blanc puis noir : visible sur une prise claire comme sur un mur sombre.
  page.drawCircle({
    x: cx,
    y: cy,
    size: RING_RADIUS + 1,
    borderColor: rgb(1, 1, 1),
    borderWidth: 1.5,
  })
  page.drawCircle({ x: cx, y: cy, size: RING_RADIUS, borderColor: rgb(0, 0, 0), borderWidth: 1.5 })

  const label = String(number)
  const labelWidth = boldFont.widthOfTextAtSize(label, LABEL_SIZE)
  const boxWidth = labelWidth + 5
  const boxHeight = LABEL_SIZE + 3
  // Le numéro se met à droite de la prise, à gauche s'il sortirait de la photo.
  const fitsRight = cx + RING_RADIUS + 2 + boxWidth <= bounds.right
  const boxX = fitsRight ? cx + RING_RADIUS + 2 : cx - RING_RADIUS - 2 - boxWidth
  const boxY = cy - boxHeight / 2
  page.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.75,
  })
  page.drawText(label, {
    x: boxX + 2.5,
    y: boxY + 2.5,
    size: LABEL_SIZE,
    font: boldFont,
    color: rgb(0, 0, 0),
  })
}
