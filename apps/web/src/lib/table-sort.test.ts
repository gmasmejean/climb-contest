import type { DataListColumn } from '@climbcontest/ui'
import { describe, expect, it } from 'vitest'

import { compareNumber, compareText, normalize, sortRows } from './table-sort'

interface Row {
  id: string
  name: string
  bib: number | null
}

const columns: DataListColumn<Row>[] = [
  { key: 'name', label: 'Nom', compare: (a, b) => compareText(a.name, b.name) },
  {
    key: 'bib',
    label: 'Dossard',
    compare: (a, b) => compareNumber(a.bib ?? 0, b.bib ?? 0),
    missing: (row) => row.bib === null,
  },
  { key: 'club', label: 'Club' },
]

const rows: Row[] = [
  { id: '1', name: 'Zoé', bib: 4 },
  { id: '2', name: 'élodie', bib: null },
  { id: '3', name: 'Ana', bib: 1 },
  { id: '4', name: 'Bruno', bib: null },
]

const names = (result: readonly Row[]) => result.map((row) => row.name)

describe('normalize', () => {
  it('efface accents, casse et espaces', () => {
    expect(normalize('  Élodie MARTIN ')).toBe('elodie martin')
  })
})

describe('compareText', () => {
  it('range sans tenir compte des accents ni de la casse', () => {
    expect(names([...rows].sort((a, b) => compareText(a.name, b.name)))).toEqual([
      'Ana',
      'Bruno',
      'élodie',
      'Zoé',
    ])
  })
})

describe('sortRows', () => {
  it('rend une copie et laisse la source intacte', () => {
    const result = sortRows(rows, { key: 'name', dir: 'asc' }, columns)
    expect(result).not.toBe(rows)
    expect(names(rows)).toEqual(['Zoé', 'élodie', 'Ana', 'Bruno'])
  })

  it('garde l’ordre reçu sans tri demandé', () => {
    expect(names(sortRows(rows, null, columns))).toEqual(names(rows))
  })

  it('garde l’ordre reçu sur une colonne non triable', () => {
    expect(names(sortRows(rows, { key: 'club', dir: 'asc' }, columns))).toEqual(names(rows))
  })

  it('garde l’ordre reçu sur une colonne inconnue', () => {
    expect(names(sortRows(rows, { key: 'fantôme', dir: 'asc' }, columns))).toEqual(names(rows))
  })

  it('inverse l’ordre en décroissant', () => {
    expect(names(sortRows(rows, { key: 'name', dir: 'desc' }, columns))).toEqual([
      'Zoé',
      'élodie',
      'Bruno',
      'Ana',
    ])
  })

  it('laisse les absents en bas en croissant', () => {
    expect(names(sortRows(rows, { key: 'bib', dir: 'asc' }, columns))).toEqual([
      'Ana',
      'Zoé',
      'élodie',
      'Bruno',
    ])
  })

  it('laisse les absents en bas en décroissant aussi', () => {
    expect(names(sortRows(rows, { key: 'bib', dir: 'desc' }, columns))).toEqual([
      'Zoé',
      'Ana',
      'élodie',
      'Bruno',
    ])
  })

  it('est stable : les ex æquo gardent leur ordre d’arrivée', () => {
    const tied: Row[] = [
      { id: 'a', name: 'Même', bib: 1 },
      { id: 'b', name: 'Même', bib: 2 },
      { id: 'c', name: 'Même', bib: 3 },
    ]
    expect(sortRows(tied, { key: 'name', dir: 'asc' }, columns).map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('applique le départage explicite quand il est donné', () => {
    const tied: Row[] = [
      { id: 'a', name: 'Même', bib: 3 },
      { id: 'b', name: 'Même', bib: 1 },
    ]
    const result = sortRows(tied, { key: 'name', dir: 'asc' }, columns, (a, b) =>
      compareNumber(a.bib ?? 0, b.bib ?? 0),
    )
    expect(result.map((row) => row.id)).toEqual(['b', 'a'])
  })
})
