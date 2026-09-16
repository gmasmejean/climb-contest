import { describe, expect, it } from 'vitest'

import {
  changeStatusInputSchema,
  createCompetitionInputSchema,
  readinessResponseSchema,
  updateCompetitionInputSchema,
} from './competition'

describe('createCompetitionInputSchema', () => {
  const valid = {
    name: 'Coupe du club',
    venue: 'Salle Roc',
    startsOn: '2026-05-01',
    endsOn: '2026-05-01',
    format: 'contest',
    scoringEngineId: 'ffme-difficulty-2026',
  }

  it('accepte une compétition valide sur un seul jour', () => {
    expect(createCompetitionInputSchema.safeParse(valid).success).toBe(true)
  })

  it('refuse une date de fin antérieure à la date de début', () => {
    const result = createCompetitionInputSchema.safeParse({
      ...valid,
      startsOn: '2026-05-02',
      endsOn: '2026-05-01',
    })
    expect(result.success).toBe(false)
  })

  it('refuse un format inconnu', () => {
    const result = createCompetitionInputSchema.safeParse({ ...valid, format: 'ligue' })
    expect(result.success).toBe(false)
  })
})

describe('updateCompetitionInputSchema', () => {
  it('accepte une mise à jour partielle (un seul champ)', () => {
    expect(updateCompetitionInputSchema.safeParse({ venue: 'Nouvelle salle' }).success).toBe(true)
  })

  it("n'accepte pas de changer le format (immuable après création)", () => {
    const result = updateCompetitionInputSchema.safeParse({ format: 'phases' })
    // Le champ surnuméraire est simplement ignoré par Zod (objet non strict),
    // pas rejeté — on vérifie qu'il n'apparaît pas dans la sortie parsée.
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).not.toHaveProperty('format')
  })
})

describe('changeStatusInputSchema', () => {
  it('refuse un statut hors énumération', () => {
    expect(changeStatusInputSchema.safeParse({ status: 'terminee' }).success).toBe(false)
  })

  it('accepte chaque statut valide', () => {
    for (const status of ['draft', 'open', 'running', 'closed', 'archived']) {
      expect(changeStatusInputSchema.safeParse({ status }).success).toBe(true)
    }
  })
})

describe('readinessResponseSchema', () => {
  it('valide une réponse de contrôle typique', () => {
    const result = readinessResponseSchema.safeParse({
      ready: false,
      checks: [
        { id: 'category_without_route', ok: true, items: [] },
        {
          id: 'competitor_without_bib',
          ok: false,
          items: [{ id: '0189dcd5-5311-7d40-8db0-9496a2eef37b', label: 'Léa Martin' }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })
})
