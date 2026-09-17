import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const MARGIN = 40
const CARD_GAP = 20
const CARDS_PER_ROW = 2
const CARDS_PER_COL = 3
const CARD_WIDTH = (A4_WIDTH - MARGIN * 2 - CARD_GAP * (CARDS_PER_ROW - 1)) / CARDS_PER_ROW
const CARD_HEIGHT = (A4_HEIGHT - MARGIN * 2 - CARD_GAP * (CARDS_PER_COL - 1)) / CARDS_PER_COL
const QR_SIZE = 130

export interface JudgeSheetEntry {
  displayName: string
  accessUrl: string
  pinRequired: boolean
  routeLabels: string[]
}

export interface QrSheetInput {
  competitionName: string
  judges: JudgeSheetEntry[]
  /** URL de la page publique (`/c/<slug>`) — pas encore construite avant le Lot 7 (DECISIONS.md ADR-026). */
  publicUrl: string
}

async function qrPng(text: string): Promise<Uint8Array> {
  return QRCode.toBuffer(text, { type: 'png', width: 400, margin: 1 })
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Planche de QR codes A4 (ROADMAP.md Lot 4, point 4) : un encart par juge —
 * jamais le PIN, seulement un emplacement pour l'écrire à la main — puis une
 * page séparée avec le QR d'accès public. Génération 100% locale (`qrcode` +
 * `pdf-lib`), aucun appel réseau (DECISIONS.md ADR-015).
 */
export async function generateQrSheet(input: QrSheetInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold)

  const cardsPerPage = CARDS_PER_ROW * CARDS_PER_COL
  const judgePages = Math.max(1, Math.ceil(input.judges.length / cardsPerPage))

  for (let pageIndex = 0; pageIndex < judgePages; pageIndex += 1) {
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    page.drawText(input.competitionName, {
      x: MARGIN,
      y: A4_HEIGHT - MARGIN + 12,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })

    const pageJudges = input.judges.slice(
      pageIndex * cardsPerPage,
      pageIndex * cardsPerPage + cardsPerPage,
    )
    for (const [index, entry] of pageJudges.entries()) {
      const col = index % CARDS_PER_ROW
      const row = Math.floor(index / CARDS_PER_ROW)
      const x = MARGIN + col * (CARD_WIDTH + CARD_GAP)
      const y = A4_HEIGHT - MARGIN - CARD_HEIGHT - row * (CARD_HEIGHT + CARD_GAP)
      await drawJudgeCard(
        pdf,
        page,
        { x, y, width: CARD_WIDTH, height: CARD_HEIGHT },
        entry,
        font,
        boldFont,
      )
    }
  }

  const publicPage = pdf.addPage([A4_WIDTH, A4_HEIGHT])
  const publicQr = await pdf.embedPng(await qrPng(input.publicUrl))
  const publicQrSize = 320
  publicPage.drawText(input.competitionName, {
    x: A4_WIDTH / 2 - boldFont.widthOfTextAtSize(input.competitionName, 22) / 2,
    y: A4_HEIGHT - 140,
    size: 22,
    font: boldFont,
  })
  publicPage.drawText('Classement en direct — scannez pour suivre la compétition', {
    x:
      A4_WIDTH / 2 -
      font.widthOfTextAtSize('Classement en direct — scannez pour suivre la compétition', 13) / 2,
    y: A4_HEIGHT - 170,
    size: 13,
    font,
  })
  publicPage.drawImage(publicQr, {
    x: A4_WIDTH / 2 - publicQrSize / 2,
    y: A4_HEIGHT / 2 - publicQrSize / 2,
    width: publicQrSize,
    height: publicQrSize,
  })

  return pdf.save()
}

async function drawJudgeCard(
  pdf: PDFDocument,
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  entry: JudgeSheetEntry,
  font: PDFFont,
  boldFont: PDFFont,
): Promise<void> {
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    borderColor: rgb(0.75, 0.75, 0.75),
    borderWidth: 1,
  })

  const padding = 12
  let cursorY = box.y + box.height - padding - 14
  page.drawText(entry.displayName, {
    x: box.x + padding,
    y: cursorY,
    size: 14,
    font: boldFont,
  })
  cursorY -= 18

  const routesLabel =
    entry.routeLabels.length > 0 ? entry.routeLabels.join(', ') : 'Aucune voie assignée'
  for (const line of wrapText(font, routesLabel, 10, box.width - padding * 2)) {
    page.drawText(line, {
      x: box.x + padding,
      y: cursorY,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
    cursorY -= 12
  }

  const qrImage = await pdf.embedPng(await qrPng(entry.accessUrl))
  const qrX = box.x + (box.width - QR_SIZE) / 2
  const qrY = box.y + padding + 22
  page.drawImage(qrImage, { x: qrX, y: qrY, width: QR_SIZE, height: QR_SIZE })

  if (entry.pinRequired) {
    page.drawText('PIN : ______', { x: box.x + padding, y: box.y + padding + 4, size: 12, font })
  } else {
    page.drawText('Accès direct — pas de PIN', {
      x: box.x + padding,
      y: box.y + padding + 4,
      size: 10,
      font,
      color: rgb(0.3, 0.3, 0.3),
    })
  }
}
