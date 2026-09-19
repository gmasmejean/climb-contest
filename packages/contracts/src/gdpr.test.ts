import { describe, expect, it } from 'vitest'

import { purgePersonalDataInputSchema, retentionStatus } from './gdpr'

describe('retentionStatus — rappel de conservation (ADR-051)', () => {
  it.each([
    ['2026-09-19', '2026-09-19', 'ok'],
    ['2026-09-19', '2028-09-18', 'ok'],
    ['2026-09-19', '2028-09-19', 'archive_due'],
    ['2026-09-19', '2030-09-19', 'archive_due'],
    ['2026-09-19', '2031-09-18', 'archive_due'],
    ['2026-09-19', '2031-09-19', 'purge_due'],
    ['2026-09-19', '2040-01-01', 'purge_due'],
  ])('fin %s, aujourd’hui %s → %s', (endsOn, today, expected) => {
    expect(retentionStatus(endsOn, today)).toBe(expected)
  })

  it('compte des années ENTIÈRES : la veille de l’anniversaire, pas encore', () => {
    expect(retentionStatus('2024-03-01', '2026-02-28')).toBe('ok')
    expect(retentionStatus('2024-03-01', '2026-03-01')).toBe('archive_due')
  })

  it('ne lève jamais sur une date mal formée : pas de rappel plutôt qu’une page cassée', () => {
    expect(retentionStatus('n’importe quoi', '2026-09-19')).toBe('ok')
    expect(retentionStatus('2026-09-19', '')).toBe('ok')
  })

  it('une compétition dans le futur est « ok »', () => {
    expect(retentionStatus('2099-01-01', '2026-09-19')).toBe('ok')
  })
})

describe('purgePersonalDataInputSchema', () => {
  it('exige un nom de confirmation', () => {
    expect(purgePersonalDataInputSchema.safeParse({}).success).toBe(false)
    expect(purgePersonalDataInputSchema.safeParse({ confirmName: 'Coupe' }).success).toBe(true)
  })
})
