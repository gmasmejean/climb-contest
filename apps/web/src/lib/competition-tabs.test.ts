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

describe('competitionTabs — pastilles (Lot 20)', () => {
  it('n’en pose aucune par défaut', () => {
    expect(competitionTabs('contest').every((tab) => tab.badge === undefined)).toBe(true)
  })

  it('décore l’onglet demandé sans toucher aux autres', () => {
    const tabs = competitionTabs('contest', {
      pilotage: { count: 2, label: '2 conflits', tone: 'danger' },
    })
    expect(tabs.find((tab) => tab.id === 'pilotage')?.badge).toEqual({
      count: 2,
      label: '2 conflits',
      tone: 'danger',
    })
    expect(tabs.find((tab) => tab.id === 'readiness')?.badge).toBeUndefined()
  })

  it('ignore une pastille visant un onglet absent du format', () => {
    const tabs = competitionTabs('contest', {
      rounds: { count: 1, label: '1 point', tone: 'warning' },
    })
    expect(tabs.map((tab) => tab.id)).not.toContain('rounds')
  })

  it('ne modifie pas la définition partagée des onglets', () => {
    competitionTabs('contest', { pilotage: { count: 9, label: '9 conflits' } })
    expect(competitionTabs('contest').find((tab) => tab.id === 'pilotage')?.badge).toBeUndefined()
  })
})
