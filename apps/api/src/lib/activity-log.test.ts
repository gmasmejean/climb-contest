import type { ActivityLogEntry } from '@climbcontest/contracts'

import { describe, expect, it } from 'vitest'

import { activityLogToCsv } from './activity-log'

function entry(overrides: Partial<ActivityLogEntry>): ActivityLogEntry {
  return {
    id: 'e1',
    createdAt: '2026-09-19T10:00:00.000Z',
    type: 'ascent_corrected',
    actorType: 'organizer',
    actorLabel: 'Alex',
    reason: null,
    payload: {},
    ...overrides,
  } as ActivityLogEntry
}

describe('activityLogToCsv — injection de formule', () => {
  it.each([['=HYPERLINK("http://evil";"x")'], ['+33 6 12 34 56 78'], ['-2+3'], ['@SUM(A1)']])(
    'neutralise un motif ou un nom qui commence par une formule : %s',
    (dangerous) => {
      const csv = activityLogToCsv([entry({ reason: dangerous, actorLabel: dangerous })])
      const dataRow = csv.split('\n')[1]!
      // Aucune cellule ne doit commencer par un préfixe de formule, quotée ou non.
      for (const cell of dataRow.match(/"(?:[^"]|"")*"/g) ?? []) {
        expect(cell.slice(1, 2)).not.toMatch(/^[=+\-@\t\r]$/)
      }
    },
  )

  it('garde le contenu lisible : l’apostrophe précède, rien n’est perdu', () => {
    const csv = activityLogToCsv([entry({ reason: '=1+1' })])
    expect(csv).toContain(`"'=1+1"`)
  })

  it('ne touche pas un motif ordinaire', () => {
    const csv = activityLogToCsv([entry({ reason: 'Erreur de saisie' })])
    expect(csv).toContain('"Erreur de saisie"')
  })
})
