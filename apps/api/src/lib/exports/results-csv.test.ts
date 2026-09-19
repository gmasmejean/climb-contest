import { describe, expect, it } from 'vitest'

import { resultsToCsv } from './results-csv'
import type { CompetitionResults } from './results'

const ROUND_Q = '00000000-0000-4000-8000-0000000000a1'
const ROUND_F = '00000000-0000-4000-8000-0000000000a2'

function routeResult(number: number, hold: number, rank: number) {
  return {
    routeId: `00000000-0000-4000-8000-00000000010${number}`,
    routeNumber: number,
    routeName: null,
    holdNumber: hold,
    modifier: 'none' as const,
    isTop: false,
    status: 'valid' as const,
    routeRank: rank,
  }
}

function phasesResults(provisional: boolean): CompetitionResults {
  return {
    competitionName: 'Coupe',
    venue: 'Salle',
    startsOn: '2026-09-19',
    endsOn: '2026-09-19',
    format: 'phases',
    categories: [
      {
        categoryId: '00000000-0000-4000-8000-0000000000c1',
        categoryLabel: 'U16 Femme',
        ranking: {
          categoryId: '00000000-0000-4000-8000-0000000000c1',
          started: true,
          provisional,
          generatedAt: '2026-09-19T10:00:00.000Z',
          entries: [
            {
              rank: 1,
              bib: 3,
              firstName: 'Léa',
              lastName: 'Martin',
              club: 'Club; Alpin',
              reachedRoundId: ROUND_F,
              rounds: [
                {
                  roundId: ROUND_Q,
                  roundType: 'qualification',
                  combinedRank: 1,
                  routes: [routeResult(1, 30, 1)],
                },
                {
                  roundId: ROUND_F,
                  roundType: 'final',
                  combinedRank: 1,
                  routes: [routeResult(2, 35, 1)],
                },
              ],
            },
            {
              rank: 2,
              bib: null,
              firstName: '=CMD',
              lastName: 'Dupont',
              club: null,
              reachedRoundId: ROUND_Q,
              rounds: [
                {
                  roundId: ROUND_Q,
                  roundType: 'qualification',
                  combinedRank: 2,
                  routes: [routeResult(1, 20, 2)],
                },
              ],
            },
          ],
        },
      },
    ],
  }
}

describe('resultsToCsv', () => {
  it('produit un en-tête puis une ligne par compétiteur', () => {
    const lines = resultsToCsv(phasesResults(false)).replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toBe('categorie;rang;dossard;nom;prenom;club;tour_atteint;detail;provisoire')
    expect(lines).toHaveLength(3)
  })

  it('porte le rang, le tour atteint et le détail de chaque voie de chaque tour', () => {
    const line = resultsToCsv(phasesResults(false)).replace('﻿', '').trim().split('\r\n')[1]!
    expect(line).toContain('U16 Femme;1;3;Martin;Léa;"Club; Alpin";Finale;')
    expect(line).toContain('Qualification voie 1 : prise 30 (rang 1)')
    expect(line).toContain('Finale voie 2 : prise 35 (rang 1)')
  })

  it('marque « oui » tant que le classement est provisoire, « non » une fois publié', () => {
    expect(resultsToCsv(phasesResults(true))).toContain(';oui\r\n')
    expect(resultsToCsv(phasesResults(false))).toContain(';non\r\n')
  })

  it('neutralise une formule dans un nom', () => {
    expect(resultsToCsv(phasesResults(false))).toContain(";Dupont;'=CMD;")
  })

  it('ne contient jamais de donnée que la page publique ne montre pas', () => {
    const header = resultsToCsv(phasesResults(false)).split('\r\n')[0]!
    expect(header).not.toMatch(/naissance|licence|annee|email/i)
  })

  it('en contest, pas de préfixe de tour ni de tour atteint', () => {
    const results = phasesResults(false)
    const contest: CompetitionResults = { ...results, format: 'contest' }
    const line = resultsToCsv(contest).replace('﻿', '').trim().split('\r\n')[1]!
    expect(line).toContain(';;')
    expect(line).not.toContain('Finale')
    expect(line).toContain('voie 1 : prise 30 (rang 1)')
  })

  it('une catégorie sans classement ne produit aucune ligne', () => {
    const results = phasesResults(false)
    results.categories[0]!.ranking = {
      ...results.categories[0]!.ranking,
      started: false,
      entries: [],
    }
    expect(resultsToCsv(results).trim().split('\r\n')).toHaveLength(1)
  })
})
