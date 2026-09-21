import { describe, expect, it } from 'vitest'

import { competitionTabs, isCompetitionTabId, resolveCompetitionTab } from './competition-tabs'

describe('competitionTabs', () => {
  it('n’expose l’onglet Tours qu’au format à phases', () => {
    expect(competitionTabs('phases').map((tab) => tab.id)).toContain('rounds')
    expect(competitionTabs('contest').map((tab) => tab.id)).not.toContain('rounds')
    expect(competitionTabs(undefined).map((tab) => tab.id)).not.toContain('rounds')
  })

  it('range les onglets en trois groupes, dans l’ordre du déroulé', () => {
    const groups = [...new Set(competitionTabs('phases').map((tab) => tab.group))]
    expect(groups).toEqual(['Préparer', 'Vérifier', 'Jour J'])
  })
})

describe('resolveCompetitionTab', () => {
  it('garde un segment connu', () => {
    expect(resolveCompetitionTab('routes', 'contest')).toBe('routes')
  })

  it('retombe sur infos sans segment ou avec un segment inconnu', () => {
    expect(resolveCompetitionTab(undefined, 'contest')).toBe('infos')
    expect(resolveCompetitionTab('', 'contest')).toBe('infos')
    expect(resolveCompetitionTab('nimporte-quoi', 'contest')).toBe('infos')
    expect(resolveCompetitionTab(['routes'], 'contest')).toBe('infos')
  })

  it('retombe sur infos pour Tours hors format à phases', () => {
    expect(resolveCompetitionTab('rounds', 'contest')).toBe('infos')
    expect(resolveCompetitionTab('rounds', 'phases')).toBe('rounds')
  })

  it('garde Tours tant que le format n’est pas chargé', () => {
    expect(resolveCompetitionTab('rounds', undefined)).toBe('rounds')
  })
})

describe('isCompetitionTabId', () => {
  it('refuse ce qui n’est pas un identifiant d’onglet', () => {
    expect(isCompetitionTabId('pilotage')).toBe(true)
    expect(isCompetitionTabId('new')).toBe(false)
    expect(isCompetitionTabId(null)).toBe(false)
  })
})
