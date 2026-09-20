import { describe, expect, it } from 'vitest'

import { daysInTrash, describeTrashAge } from './trash-age'

describe('daysInTrash', () => {
  it('compte des jours de calendrier locaux, pas des tranches de 24 h', () => {
    const evening = new Date(2026, 8, 19, 22, 30).toISOString()
    // 8 h le lendemain : 9 h 30 plus tard seulement, mais « depuis 1 jour ».
    expect(daysInTrash(evening, new Date(2026, 8, 20, 8, 0))).toBe(1)
    expect(daysInTrash(evening, new Date(2026, 8, 19, 23, 59))).toBe(0)
  })

  it('reste sûr si l’horloge du serveur est en avance sur celle du téléphone', () => {
    const future = new Date(2026, 8, 21, 10, 0).toISOString()
    expect(daysInTrash(future, new Date(2026, 8, 20, 10, 0))).toBe(0)
  })

  it('traverse un changement d’heure sans se tromper d’un jour', () => {
    // Passage à l'heure d'hiver en Europe le 25 octobre 2026 : ce jour dure 25 h.
    const before = new Date(2026, 9, 24, 12, 0).toISOString()
    expect(daysInTrash(before, new Date(2026, 9, 26, 12, 0))).toBe(2)
  })
})

describe('describeTrashAge', () => {
  const now = new Date(2026, 8, 20, 12, 0)
  it('dit aujourd’hui, 1 jour, n jours', () => {
    expect(describeTrashAge(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toBe(
      'Mise à la corbeille aujourd’hui',
    )
    expect(describeTrashAge(new Date(2026, 8, 19, 9, 0).toISOString(), now)).toBe(
      'À la corbeille depuis 1 jour',
    )
    expect(describeTrashAge(new Date(2026, 8, 10, 9, 0).toISOString(), now)).toBe(
      'À la corbeille depuis 10 jours',
    )
  })
})
