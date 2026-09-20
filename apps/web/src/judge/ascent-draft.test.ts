import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearAscentDraft,
  DRAFT_MAX_AGE_MS,
  judgeDraft,
  loadAscentDraft,
  parseAscentDraft,
  purgeAscentDraft,
  saveAscentDraft,
  sameDraftValues,
  type AscentDraft,
  type AscentDraftValues,
  type DraftTarget,
} from './ascent-draft'

const NOW = 1_800_000_000_000

const target: DraftTarget = {
  routeId: 'route-1',
  competitorId: 'comp-1',
  baseAscentId: null,
  holdCount: 40,
}

const values: AscentDraftValues = {
  holdNumber: 25,
  modifier: 'plus',
  isTop: false,
  status: 'valid',
  climbTimeMs: null,
}

function draftOf(overrides: Partial<AscentDraft> = {}): AscentDraft {
  return {
    routeId: 'route-1',
    competitorId: 'comp-1',
    baseAscentId: null,
    savedAt: NOW,
    ...values,
    ...overrides,
  }
}

describe('parseAscentDraft', () => {
  it('lit un brouillon complet', () => {
    expect(parseAscentDraft(JSON.stringify(draftOf()))).toEqual(draftOf())
  })

  it('accepte une saisie pas finie : passage valide sans prise ni TOP', () => {
    const unfinished = draftOf({ holdNumber: null, modifier: 'plus' })
    expect(parseAscentDraft(JSON.stringify(unfinished))).toEqual(unfinished)
  })

  it.each([
    ['du JSON illisible', '{pas du json'],
    ['une valeur qui n’est pas un objet', '42'],
    ['un champ manquant', JSON.stringify({ ...draftOf(), routeId: undefined })],
    ['un modificateur inconnu', JSON.stringify({ ...draftOf(), modifier: 'minus' })],
    [
      'un statut inconnu (DSQ n’est jamais proposé au juge)',
      JSON.stringify(draftOf({ status: 'dsq' as never })),
    ],
    ['un numéro de prise nul', JSON.stringify(draftOf({ holdNumber: 0 }))],
    ['un numéro de prise décimal', JSON.stringify(draftOf({ holdNumber: 2.5 }))],
    ['un TOP qui porte une prise', JSON.stringify(draftOf({ isTop: true, holdNumber: 12 }))],
    ['un DNS qui porte une prise', JSON.stringify(draftOf({ status: 'dns', holdNumber: 12 }))],
    [
      'un DNF marqué TOP',
      JSON.stringify(draftOf({ status: 'dnf', holdNumber: null, isTop: true })),
    ],
    ['un temps négatif', JSON.stringify(draftOf({ climbTimeMs: -1 }))],
  ])('rejette %s', (_label, raw) => {
    expect(parseAscentDraft(raw)).toBeNull()
  })
})

describe('judgeDraft', () => {
  it('reprend un brouillon frais du même passage', () => {
    expect(judgeDraft(draftOf(), target, NOW + 1000)).toBe('usable')
  })

  it('reprend un brouillon d’exactement 10 minutes, pas d’une milliseconde de plus', () => {
    expect(judgeDraft(draftOf(), target, NOW + DRAFT_MAX_AGE_MS)).toBe('usable')
    expect(judgeDraft(draftOf(), target, NOW + DRAFT_MAX_AGE_MS + 1)).toBe('dead')
  })

  it('traite une date dans le futur (horloge reculée) comme périmée', () => {
    expect(judgeDraft(draftOf({ savedAt: NOW + 1 }), target, NOW)).toBe('dead')
  })

  it('laisse en place le brouillon d’un autre compétiteur ou d’une autre voie', () => {
    expect(judgeDraft(draftOf({ competitorId: 'comp-2' }), target, NOW)).toBe('other-screen')
    expect(judgeDraft(draftOf({ routeId: 'route-2' }), target, NOW)).toBe('other-screen')
  })

  it('supprime un brouillon périmé même s’il est d’un autre écran', () => {
    const stale = draftOf({ competitorId: 'comp-2' })
    expect(judgeDraft(stale, target, NOW + DRAFT_MAX_AGE_MS + 1)).toBe('dead')
  })

  it('écarte le brouillon d’une création quand le passage existe désormais', () => {
    // La saisie a été confirmée entre-temps : l'écran repart d'un passage `a1`.
    expect(
      judgeDraft(draftOf({ baseAscentId: null }), { ...target, baseAscentId: 'a1' }, NOW),
    ).toBe('dead')
  })

  it('écarte le brouillon d’une correction quand le passage corrigé a changé d’id', () => {
    expect(
      judgeDraft(draftOf({ baseAscentId: 'a1' }), { ...target, baseAscentId: 'a2' }, NOW),
    ).toBe('dead')
  })

  it('reprend le brouillon d’une correction du même passage', () => {
    expect(
      judgeDraft(draftOf({ baseAscentId: 'a1' }), { ...target, baseAscentId: 'a1' }, NOW),
    ).toBe('usable')
  })

  it('écarte une prise hors de la voie, accepte la dernière', () => {
    expect(judgeDraft(draftOf({ holdNumber: 41 }), target, NOW)).toBe('dead')
    expect(judgeDraft(draftOf({ holdNumber: 40 }), target, NOW)).toBe('usable')
  })
})

describe('sameDraftValues', () => {
  it('compare les cinq valeurs', () => {
    expect(sameDraftValues(values, { ...values })).toBe(true)
    expect(sameDraftValues(values, { ...values, holdNumber: 26 })).toBe(false)
    expect(sameDraftValues(values, { ...values, modifier: 'none' })).toBe(false)
    expect(sameDraftValues(values, { ...values, isTop: true })).toBe(false)
    expect(sameDraftValues(values, { ...values, status: 'dns' })).toBe(false)
    expect(sameDraftValues(values, { ...values, climbTimeMs: 1200 })).toBe(false)
  })
})

describe('stockage local', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const KEY = 'climbcontest.judge.ascentDraft'

  it('écrit puis relit les valeurs', () => {
    saveAscentDraft(target, values, NOW)
    expect(loadAscentDraft(target, NOW + 5000)).toEqual(values)
  })

  it('ne rend rien quand il n’y a pas de brouillon', () => {
    expect(loadAscentDraft(target, NOW)).toBeNull()
  })

  it('supprime un brouillon périmé en le lisant', () => {
    saveAscentDraft(target, values, NOW)
    expect(loadAscentDraft(target, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('supprime un brouillon illisible en le lisant', () => {
    localStorage.setItem(KEY, '{cassé')
    expect(loadAscentDraft(target, NOW)).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('laisse en place le brouillon d’un autre passage', () => {
    saveAscentDraft({ ...target, competitorId: 'comp-2' }, values, NOW)
    expect(loadAscentDraft(target, NOW)).toBeNull()
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('n’efface que le brouillon du passage demandé', () => {
    saveAscentDraft({ ...target, competitorId: 'comp-2' }, values, NOW)
    clearAscentDraft({ routeId: 'route-1', competitorId: 'comp-1' })
    expect(localStorage.getItem(KEY)).not.toBeNull()

    clearAscentDraft({ routeId: 'route-1', competitorId: 'comp-2' })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('purge sans condition', () => {
    saveAscentDraft(target, values, NOW)
    purgeAscentDraft()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('n’échoue pas quand le stockage est inaccessible', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqué', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('bloqué', 'SecurityError')
    })

    expect(() => saveAscentDraft(target, values, NOW)).not.toThrow()
    expect(loadAscentDraft(target, NOW)).toBeNull()
    expect(() => clearAscentDraft(target)).not.toThrow()
    expect(() => purgeAscentDraft()).not.toThrow()
  })
})
