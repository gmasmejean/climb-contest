import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'

import { toSupportedText, wrapText } from './pdf-text'
import { formatAscentResult, roundTypeLabel, type CompetitionResults } from './results'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2

const COL_RANK = MARGIN
const COL_BIB = MARGIN + 34
const COL_NAME = MARGIN + 78
const COL_CLUB = MARGIN + 290
const COL_ROUND = MARGIN + 430
const NAME_WIDTH = COL_CLUB - COL_NAME - 8
const CLUB_WIDTH = COL_ROUND - COL_CLUB - 8

/** `2026-09-19` → `19/09/2026`, sans passer par `Date` (pas de fuseau ici). */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}/${month}/${year}` : iso
}

const GREY = rgb(0.4, 0.4, 0.4)
const LIGHT = rgb(0.85, 0.85, 0.85)
const ORANGE = rgb(0.72, 0.36, 0.0)

/**
 * Résultats mis en page pour l'affichage et l'archivage (ROADMAP.md Lot 9,
 * point 2) : une catégorie par page (ou davantage si elle est longue), le
 * détail de chaque voie sous chaque compétiteur, la mention « provisoire »
 * tant que le classement n'est pas publié, et la date de génération passée en
 * paramètre — jamais `Date.now()` ici, pour qu'un même classement donne
 * exactement le même document.
 */
export async function resultsToPdf(
  results: CompetitionResults,
  generatedAt: Date,
): Promise<Uint8Array> {
  // Métadonnées fixées explicitement : par défaut pdf-lib y écrit l'heure
  // courante, ce qui rendrait deux générations du même classement différentes
  // octet pour octet.
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.setTitle(`Résultats — ${results.competitionName}`)
  pdf.setCreator('ClimbContest')
  pdf.setProducer('ClimbContest')
  pdf.setCreationDate(generatedAt)
  pdf.setModificationDate(generatedAt)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const t = (text: string, f: PDFFont = font) => toSupportedText(f, text)

  const pages: PDFPage[] = []
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(generatedAt)

  function newPage(
    categoryLabel: string,
    provisional: boolean,
    continued: boolean,
  ): { page: PDFPage; y: number } {
    const page = pdf.addPage([A4_WIDTH, A4_HEIGHT])
    pages.push(page)
    let y = A4_HEIGHT - MARGIN

    page.drawText(t(results.competitionName, bold), { x: MARGIN, y: y - 14, size: 16, font: bold })
    y -= 34
    const dates =
      results.startsOn === results.endsOn
        ? formatIsoDate(results.startsOn)
        : `${formatIsoDate(results.startsOn)} au ${formatIsoDate(results.endsOn)}`
    page.drawText(t(`${results.venue} — ${dates}`), { x: MARGIN, y, size: 10, font, color: GREY })
    y -= 28

    page.drawText(t(`${categoryLabel}${continued ? ' (suite)' : ''}`, bold), {
      x: MARGIN,
      y,
      size: 14,
      font: bold,
    })
    if (provisional) {
      const label = 'CLASSEMENT PROVISOIRE'
      page.drawText(label, {
        x: A4_WIDTH - MARGIN - bold.widthOfTextAtSize(label, 10),
        y: y + 2,
        size: 10,
        font: bold,
        color: ORANGE,
      })
    }
    y -= 20

    const headers: [string, number][] = [
      ['Rang', COL_RANK],
      ['Dossard', COL_BIB],
      ['Nom', COL_NAME],
      ['Club', COL_CLUB],
      ...(results.format === 'phases' ? ([['Tour atteint', COL_ROUND]] as [string, number][]) : []),
    ]
    for (const [label, x] of headers) {
      page.drawText(label, { x, y, size: 9, font: bold, color: GREY })
    }
    y -= 6
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4_WIDTH - MARGIN, y },
      thickness: 0.8,
      color: GREY,
    })
    return { page, y: y - 14 }
  }

  if (results.categories.length === 0) {
    const { page } = newPage('Aucune catégorie', false, false)
    page.drawText('Cette compétition ne compte aucune catégorie.', {
      x: MARGIN,
      y: A4_HEIGHT - 200,
      size: 11,
      font,
    })
  }

  for (const cat of results.categories) {
    const provisional = cat.ranking.provisional
    let { page, y } = newPage(cat.categoryLabel, provisional, false)

    if (cat.ranking.entries.length === 0) {
      page.drawText('Aucun classement pour le moment.', {
        x: MARGIN,
        y,
        size: 11,
        font,
        color: GREY,
      })
      continue
    }

    for (const entry of cat.ranking.entries) {
      const detailText = entry.rounds
        .map((roundDetail) => {
          const prefix =
            results.format === 'phases' ? `${roundTypeLabel(roundDetail.roundType)} : ` : ''
          return (
            prefix +
            roundDetail.routes
              .map((r) => `voie ${r.routeNumber} ${formatAscentResult(r)} (${r.routeRank}e)`)
              .join(', ')
          )
        })
        .join('  |  ')
      const detailLines = wrapText(font, t(detailText), 8, CONTENT_WIDTH - 78)
      const nameLines = wrapText(
        bold,
        t(`${entry.firstName} ${entry.lastName}`, bold),
        10,
        NAME_WIDTH,
      )
      const rowHeight = Math.max(nameLines.length, 1) * 12 + detailLines.length * 10 + 8

      if (y - rowHeight < MARGIN + 30) {
        ;({ page, y } = newPage(cat.categoryLabel, provisional, true))
      }

      page.drawText(String(entry.rank), { x: COL_RANK, y, size: 11, font: bold })
      page.drawText(entry.bib === null ? '' : String(entry.bib), { x: COL_BIB, y, size: 10, font })
      for (const [index, line] of nameLines.entries()) {
        page.drawText(line, { x: COL_NAME, y: y - index * 12, size: 10, font: bold })
      }
      const clubLine = wrapText(font, t(entry.club ?? ''), 9, CLUB_WIDTH)[0] ?? ''
      page.drawText(clubLine, { x: COL_CLUB, y, size: 9, font })
      if (results.format === 'phases') {
        const reached = entry.rounds.find((r) => r.roundId === entry.reachedRoundId)
        page.drawText(reached ? roundTypeLabel(reached.roundType) : '', {
          x: COL_ROUND,
          y,
          size: 9,
          font,
        })
      }

      let lineY = y - Math.max(nameLines.length, 1) * 12 + 2
      for (const line of detailLines) {
        page.drawText(line, { x: COL_NAME, y: lineY, size: 8, font, color: GREY })
        lineY -= 10
      }
      const separatorY = lineY - 2
      page.drawLine({
        start: { x: MARGIN, y: separatorY },
        end: { x: A4_WIDTH - MARGIN, y: separatorY },
        thickness: 0.4,
        color: LIGHT,
      })
      y = separatorY - 14
    }
  }

  for (const [index, page] of pages.entries()) {
    const footer = `Page ${index + 1} / ${pages.length}  —  généré le ${stamp}`
    page.drawText(t(footer), { x: MARGIN, y: MARGIN - 14, size: 8, font, color: GREY })
  }

  return pdf.save()
}
