import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LIST_VIEW,
  applyListView,
  isDefaultListView,
  toLocalDay,
  parseListView,
  serializeListView,
  type ListView,
  type ListedCompetition,
} from './competition-list-view'

const TODAY = '2026-09-20'

function make(overrides: Partial<ListedCompetition> & { id: string }): ListedCompetition {
  return {
    name: 'Compétition',
    venue: 'Salle',
    status: 'draft',
    startsOn: '2026-01-01',
    endsOn: '2026-01-01',
    ...overrides,
  }
}

const view = (overrides: Partial<ListView>): ListView => ({ ...DEFAULT_LIST_VIEW, ...overrides })
const ids = (rows: readonly ListedCompetition[]): string[] => rows.map((row) => row.id)

describe('applyListView — recherche', () => {
  const rows = [
    make({ id: 'a', name: 'Coupe d’été', venue: 'Gymnase Jean Moulin' }),
    make({ id: 'b', name: 'Open de Lyon', venue: 'Bloc & Co' }),
    make({ id: 'c', name: 'Trophée des Écrins', venue: 'Briançon' }),
  ]

  it('ignore la casse et les accents', () => {
    expect(ids(applyListView(rows, view({ q: 'ETE' }), TODAY))).toEqual(['a'])
    expect(ids(applyListView(rows, view({ q: 'ecrins' }), TODAY))).toEqual(['c'])
    expect(ids(applyListView(rows, view({ q: 'trophée' }), TODAY))).toEqual(['c'])
  })

  it('cherche aussi dans le lieu', () => {
    expect(ids(applyListView(rows, view({ q: 'briancon' }), TODAY))).toEqual(['c'])
  })

  it('exige que tous les mots soient présents, dans n’importe quel ordre', () => {
    expect(ids(applyListView(rows, view({ q: 'lyon open' }), TODAY))).toEqual(['b'])
    expect(applyListView(rows, view({ q: 'lyon briancon' }), TODAY)).toEqual([])
  })

  it('une recherche vide ou faite d’espaces ne filtre rien', () => {
    expect(applyListView(rows, view({ q: '   ' }), TODAY)).toHaveLength(3)
  })
})

describe('applyListView — statuts', () => {
  const rows = [
    make({ id: 'd', status: 'draft' }),
    make({ id: 'o', status: 'open' }),
    make({ id: 'r', status: 'running' }),
    make({ id: 'c', status: 'closed' }),
    make({ id: 'x', status: 'archived' }),
  ]

  it('sans statut choisi, tout est visible (archivées comprises)', () => {
    expect(applyListView(rows, view({ statuses: [] }), TODAY)).toHaveLength(5)
  })

  it('garde les statuts choisis, plusieurs à la fois', () => {
    const kept = applyListView(
      rows,
      view({ statuses: ['open', 'running'], sort: 'status', dir: 'asc' }),
      TODAY,
    )
    expect(ids(kept)).toEqual(['o', 'r'])
  })
})

describe('applyListView — dates', () => {
  const rows = [
    make({ id: 'p', startsOn: '2026-03-10', endsOn: '2026-03-11' }),
    make({ id: 'now', startsOn: '2026-09-19', endsOn: '2026-09-21' }),
    make({ id: 'today', startsOn: '2026-09-20', endsOn: '2026-09-20' }),
    make({ id: 'f', startsOn: '2026-11-01', endsOn: '2026-11-02' }),
  ]

  it('la période porte sur la date de début, bornes incluses', () => {
    const kept = applyListView(rows, view({ from: '2026-09-19', to: '2026-09-20' }), TODAY)
    expect(ids(kept).sort()).toEqual(['now', 'today'])
  })

  it('accepte une borne seule', () => {
    expect(ids(applyListView(rows, view({ from: '2026-11-01' }), TODAY))).toEqual(['f'])
    expect(ids(applyListView(rows, view({ to: '2026-03-10' }), TODAY))).toEqual(['p'])
  })

  it('« À venir » garde ce qui n’est pas terminé, y compris ce qui est en cours', () => {
    const kept = applyListView(rows, view({ when: 'upcoming' }), TODAY)
    expect(ids(kept).sort()).toEqual(['f', 'now', 'today'])
  })

  it('« Passées » garde ce qui est terminé avant aujourd’hui', () => {
    expect(ids(applyListView(rows, view({ when: 'past' }), TODAY))).toEqual(['p'])
  })

  it('« À venir » et « Passées » se partagent la liste sans trou ni doublon', () => {
    const upcoming = ids(applyListView(rows, view({ when: 'upcoming' }), TODAY))
    const past = ids(applyListView(rows, view({ when: 'past' }), TODAY))
    expect([...upcoming, ...past].sort()).toEqual(['f', 'now', 'p', 'today'])
  })
})

describe('applyListView — tri', () => {
  it('trie par date décroissante par défaut', () => {
    const rows = [
      make({ id: 'old', startsOn: '2025-01-01' }),
      make({ id: 'new', startsOn: '2026-06-01' }),
      make({ id: 'mid', startsOn: '2025-09-01' }),
    ]
    expect(ids(applyListView(rows, DEFAULT_LIST_VIEW, TODAY))).toEqual(['new', 'mid', 'old'])
  })

  it('trie par date croissante', () => {
    const rows = [
      make({ id: 'new', startsOn: '2026-06-01' }),
      make({ id: 'old', startsOn: '2025-01-01' }),
    ]
    expect(ids(applyListView(rows, view({ sort: 'date', dir: 'asc' }), TODAY))).toEqual([
      'old',
      'new',
    ])
  })

  it('trie par nom sans tenir compte des accents ni de la casse', () => {
    const rows = [
      make({ id: '1', name: 'zèbre' }),
      make({ id: '2', name: 'Écureuil' }),
      make({ id: '3', name: 'abeille' }),
      make({ id: '4', name: 'Ecrins' }),
    ]
    expect(ids(applyListView(rows, view({ sort: 'name', dir: 'asc' }), TODAY))).toEqual([
      '3',
      '4',
      '2',
      '1',
    ])
    expect(ids(applyListView(rows, view({ sort: 'name', dir: 'desc' }), TODAY))).toEqual([
      '1',
      '2',
      '4',
      '3',
    ])
  })

  it('trie les statuts dans l’ordre du cycle de vie, pas alphabétique', () => {
    const rows = [
      make({ id: 'closed', status: 'closed' }),
      make({ id: 'archived', status: 'archived' }),
      make({ id: 'draft', status: 'draft' }),
      make({ id: 'running', status: 'running' }),
      make({ id: 'open', status: 'open' }),
    ]
    expect(ids(applyListView(rows, view({ sort: 'status', dir: 'asc' }), TODAY))).toEqual([
      'draft',
      'open',
      'running',
      'closed',
      'archived',
    ])
    expect(ids(applyListView(rows, view({ sort: 'status', dir: 'desc' }), TODAY))).toEqual([
      'archived',
      'closed',
      'running',
      'open',
      'draft',
    ])
  })

  it('départage les égalités par date de début décroissante, puis nom, puis identifiant', () => {
    const rows = [
      make({ id: 'z', status: 'open', name: 'B', startsOn: '2026-01-01' }),
      make({ id: 'y', status: 'open', name: 'A', startsOn: '2026-01-01' }),
      make({ id: 'x', status: 'open', name: 'A', startsOn: '2026-05-01' }),
      make({ id: 'w', status: 'open', name: 'A', startsOn: '2026-01-01' }),
    ]
    const sorted = ids(applyListView(rows, view({ sort: 'status', dir: 'asc' }), TODAY))
    expect(sorted).toEqual(['x', 'w', 'y', 'z'])
    // Déterministe : l’ordre d’entrée ne change pas le résultat.
    expect(
      ids(applyListView([...rows].reverse(), view({ sort: 'status', dir: 'asc' }), TODAY)),
    ).toEqual(sorted)
  })

  it('ne modifie pas la liste d’entrée', () => {
    const rows = [
      make({ id: 'b', startsOn: '2025-01-01' }),
      make({ id: 'a', startsOn: '2026-01-01' }),
    ]
    applyListView(rows, DEFAULT_LIST_VIEW, TODAY)
    expect(ids(rows)).toEqual(['b', 'a'])
  })
})

describe('parseListView / serializeListView', () => {
  it('une adresse vide donne la vue par défaut', () => {
    expect(parseListView({})).toEqual(DEFAULT_LIST_VIEW)
    expect(isDefaultListView(parseListView({}))).toBe(true)
  })

  it('reconstruit une vue complète depuis l’adresse', () => {
    expect(
      parseListView({
        q: 'coupe',
        status: 'open,running',
        from: '2026-01-01',
        to: '2026-12-31',
        when: 'upcoming',
        sort: 'name',
        dir: 'asc',
      }),
    ).toEqual({
      q: 'coupe',
      statuses: ['open', 'running'],
      from: '2026-01-01',
      to: '2026-12-31',
      when: 'upcoming',
      sort: 'name',
      dir: 'asc',
    })
  })

  it('ignore les valeurs invalides plutôt que de casser la page', () => {
    expect(
      parseListView({
        status: 'open,nimporte,open',
        from: '2026-13-45',
        to: 'demain',
        when: 'jamais',
        sort: 'prix',
        dir: 'sideways',
      }),
    ).toEqual({ ...DEFAULT_LIST_VIEW, statuses: ['open'] })
  })

  it('prend la première valeur quand un paramètre est répété', () => {
    expect(parseListView({ q: ['un', 'deux'] }).q).toBe('un')
  })

  it('n’écrit dans l’adresse que ce qui s’écarte de la vue par défaut', () => {
    expect(serializeListView(DEFAULT_LIST_VIEW)).toEqual({})
    expect(
      serializeListView(view({ q: 'coupe', statuses: ['open'], sort: 'name', dir: 'asc' })),
    ).toEqual({
      q: 'coupe',
      status: 'open',
      sort: 'name',
      dir: 'asc',
    })
  })

  it('aller-retour : parse(serialize(v)) === v', () => {
    const original = view({
      q: 'été',
      statuses: ['draft', 'archived'],
      from: '2026-02-01',
      to: '2026-02-28',
      when: 'past',
      sort: 'status',
      dir: 'desc',
    })
    expect(parseListView(serializeListView(original))).toEqual(original)
  })
})

describe('toLocalDay', () => {
  it('donne la date du calendrier local, pas la date UTC', () => {
    expect(toLocalDay(new Date(2026, 8, 20, 0, 30))).toBe('2026-09-20')
    expect(toLocalDay(new Date(2026, 8, 20, 23, 59))).toBe('2026-09-20')
    expect(toLocalDay(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05')
  })
})
