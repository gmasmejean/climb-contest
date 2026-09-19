import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { resultsToPdf } from './results-pdf'
import type { CompetitionResults } from './results'

const ROUND = '00000000-0000-4000-8000-0000000000a1'
const NOW = new Date('2026-09-19T10:00:00.000Z')

function entry(rank: number, name: string, club: string | null = 'Club Alpin') {
  return {
    rank,
    bib: rank,
    firstName: name,
    lastName: `Nom${rank}`,
    club,
    reachedRoundId: ROUND,
    rounds: [
      {
        roundId: ROUND,
        roundType: 'qualification' as const,
        combinedRank: rank,
        routes: [1, 2, 3].map((n) => ({
          routeId: `00000000-0000-4000-8000-00000000010${n}`,
          routeNumber: n,
          routeName: null,
          holdNumber: 20 + n,
          modifier: 'plus' as const,
          isTop: false,
          status: 'valid' as const,
          routeRank: rank,
        })),
      },
    ],
  }
}

function results(
  categories: { label: string; count: number; provisional?: boolean }[],
): CompetitionResults {
  return {
    competitionName: 'Coupe du Club',
    venue: 'Salle Roc',
    startsOn: '2026-09-19',
    endsOn: '2026-09-19',
    format: 'phases',
    categories: categories.map((cat, index) => ({
      categoryId: `00000000-0000-4000-8000-0000000000c${index}`,
      categoryLabel: cat.label,
      ranking: {
        categoryId: `00000000-0000-4000-8000-0000000000c${index}`,
        started: cat.count > 0,
        provisional: cat.provisional ?? false,
        generatedAt: NOW.toISOString(),
        entries: Array.from({ length: cat.count }, (_, i) => entry(i + 1, `Prénom${i + 1}`)),
      },
    })),
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}

describe('resultsToPdf', () => {
  it('produit un PDF valide', async () => {
    const bytes = await resultsToPdf(results([{ label: 'U16 Femme', count: 3 }]), NOW)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(await pageCount(bytes)).toBe(1)
  })

  it('met chaque catégorie sur sa propre page', async () => {
    const bytes = await resultsToPdf(
      results([
        { label: 'U16 Femme', count: 3 },
        { label: 'U16 Homme', count: 3 },
        { label: 'Senior', count: 2 },
      ]),
      NOW,
    )
    expect(await pageCount(bytes)).toBe(3)
  })

  it('continue sur une page suivante quand une catégorie est longue', async () => {
    const bytes = await resultsToPdf(results([{ label: 'U16 Femme', count: 90 }]), NOW)
    expect(await pageCount(bytes)).toBeGreaterThan(1)
  })

  it('accepte une catégorie sans classement et une compétition sans catégorie', async () => {
    expect(await pageCount(await resultsToPdf(results([{ label: 'Vide', count: 0 }]), NOW))).toBe(1)
    expect(await pageCount(await resultsToPdf(results([]), NOW))).toBe(1)
  })

  it('ne plante jamais sur un nom que la police standard ne sait pas encoder', async () => {
    const weird = results([{ label: 'Catégorie 日本', count: 1 }])
    weird.categories[0]!.ranking.entries[0] = {
      ...weird.categories[0]!.ranking.entries[0]!,
      firstName: 'Łukasz 😀',
      club: 'Клуб',
    }
    weird.competitionName = 'Coupe «Œuf» — Ürümqi 🧗'
    expect(await pageCount(await resultsToPdf(weird, NOW))).toBe(1)
  })

  it('accepte un mot plus long que la largeur de la colonne', async () => {
    const long = results([{ label: 'U16', count: 1 }])
    long.categories[0]!.ranking.entries[0] = {
      ...long.categories[0]!.ranking.entries[0]!,
      lastName: 'A'.repeat(200),
    }
    expect(await pageCount(await resultsToPdf(long, NOW))).toBe(1)
  })

  it('est déterministe : la même entrée donne exactement les mêmes octets', async () => {
    const input = results([{ label: 'U16 Femme', count: 5, provisional: true }])
    const first = await resultsToPdf(input, NOW)
    const second = await resultsToPdf(input, NOW)
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
  })

  it('la date de génération change le document (elle est bien affichée)', async () => {
    const input = results([{ label: 'U16 Femme', count: 2 }])
    const a = await resultsToPdf(input, NOW)
    const b = await resultsToPdf(input, new Date('2026-10-01T08:00:00.000Z'))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})
