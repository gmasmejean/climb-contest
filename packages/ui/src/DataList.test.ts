import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DataList from './DataList.vue'
import type { DataListColumn } from './data-list'

interface Climber {
  id: string
  bib: number | null
  name: string
  club: string
}

const rows: Climber[] = [
  { id: 'a', bib: 12, name: 'Léa Martin', club: 'CAF Lyon' },
  { id: 'b', bib: null, name: 'Éric Dubois', club: 'ESC Annecy' },
  { id: 'c', bib: 3, name: 'Ana Costa', club: 'CAF Lyon' },
]

const columns: DataListColumn<Climber>[] = [
  {
    key: 'name',
    label: 'Nom',
    card: 'title',
    value: (row) => row.name,
    compare: (a, b) => a.name.localeCompare(b.name, 'fr'),
  },
  {
    key: 'bib',
    label: 'Dossard',
    value: (row) => String(row.bib ?? '—'),
    compare: (a, b) => (a.bib ?? 0) - (b.bib ?? 0),
    missing: (row) => row.bib === null,
  },
  { key: 'club', label: 'Club', value: (row) => row.club },
]

/** `RouterLink` sans routeur : on ne teste pas la navigation, seulement le rendu. */
const global = { stubs: { RouterLink: { template: '<a><slot /></a>' } } }

/**
 * `mount(DataList<Climber>, …)` et non `mount(DataList, …)` : sans l'expression
 * d'instanciation, le générique retombe sur sa contrainte `{ id: string }` et on
 * perd le type de la ligne dans les comparateurs.
 */
type ListProps = Parameters<typeof DataList<Climber>>[0]

function cards(props: Partial<ListProps> = {}, slots: Record<string, string> = {}) {
  return mount(DataList<Climber>, {
    props: { rows, columns, label: 'Compétiteurs', ...props },
    slots,
    global,
  })
}

function table(props: Partial<ListProps> = {}, slots: Record<string, string> = {}) {
  return cards({ layout: 'table', ...props }, slots)
}

describe('DataList — les deux rendus', () => {
  it('ne met qu’un seul arbre dans le DOM : cartes', () => {
    const wrapper = cards()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('ul > li')).toHaveLength(3)
  })

  it('ne met qu’un seul arbre dans le DOM : tableau', () => {
    const wrapper = table()
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
  })
})

describe('DataList — tri', () => {
  it('émet update:sort en croissant au premier clic', async () => {
    const wrapper = table()
    await wrapper.findAll('thead button')[0]?.trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual([{ key: 'name', dir: 'asc' }])
  })

  it('bascule en décroissant au second clic sur la colonne active', async () => {
    const wrapper = table({ sort: { key: 'name', dir: 'asc' } })
    await wrapper.findAll('thead button')[0]?.trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual([{ key: 'name', dir: 'desc' }])
  })

  it('repart en croissant quand on change de colonne', async () => {
    const wrapper = table({ sort: { key: 'name', dir: 'desc' } })
    await wrapper.findAll('thead button')[1]?.trigger('click')
    expect(wrapper.emitted('update:sort')?.[0]).toEqual([{ key: 'bib', dir: 'asc' }])
  })

  it('ne réordonne pas les lignes lui-même : le tri est piloté', async () => {
    const wrapper = table()
    const before = wrapper.findAll('tbody tr').map((row) => row.text())
    await wrapper.findAll('thead button')[0]?.trigger('click')
    expect(wrapper.findAll('tbody tr').map((row) => row.text())).toEqual(before)
  })

  it('n’affiche pas de bouton sur une colonne non triable', () => {
    expect(table().findAll('thead button')).toHaveLength(2)
  })
})

describe('DataList — accessibilité du tableau', () => {
  it('nomme le tableau par sa légende', () => {
    expect(table().find('caption').text()).toBe('Compétiteurs')
  })

  it('porte aria-sort sur le th, une seule colonne active', () => {
    const headers = table({ sort: { key: 'bib', dir: 'desc' } }).findAll('thead th')
    expect(headers.map((th) => th.attributes('aria-sort'))).toEqual([
      'none',
      'descending',
      undefined,
    ])
  })

  it('n’annonce jamais aria-sort sur une liste sans colonne triable', () => {
    const fixed = columns.map((column) => ({ ...column, compare: undefined }))
    const wrapper = table({ columns: fixed })
    expect(
      wrapper.findAll('thead th').every((th) => th.attributes('aria-sort') === undefined),
    ).toBe(true)
  })

  it('fait de la première cellule un en-tête de ligne', () => {
    const first = table().find('tbody tr')
    expect(first.find('th').attributes('scope')).toBe('row')
    expect(first.findAll('td')).toHaveLength(2)
  })
})

describe('DataList — colonnes et slots', () => {
  it('laisse le slot cell-<clé> primer sur value', () => {
    const wrapper = table({}, { 'cell-club': '<b>{{ params.row.club }} !</b>' })
    expect(wrapper.find('tbody b').text()).toBe('CAF Lyon !')
  })

  it('rend une cellule vide quand la colonne n’a ni value ni slot', () => {
    const wrapper = table({ columns: [{ key: 'actions', label: 'Actions' }] })
    expect(wrapper.find('tbody th').text()).toBe('')
  })

  it('retire du tableau une colonne tableHidden mais la garde en carte', () => {
    const marked = columns.map((column) =>
      column.key === 'club' ? { ...column, tableHidden: true } : column,
    )
    expect(table({ columns: marked }).findAll('thead th')).toHaveLength(2)
    expect(cards({ columns: marked }).text()).toContain('CAF Lyon')
  })

  it('range les rôles de carte aux bons endroits', () => {
    const roled: DataListColumn<Climber>[] = [
      { key: 'name', label: 'Nom', card: 'title', value: (row) => row.name },
      { key: 'club', label: 'Club', card: 'subtitle', value: (row) => row.club },
      { key: 'bib', label: 'Dossard', card: 'hidden', value: (row) => String(row.bib) },
    ]
    const card = cards({ rows: rows.slice(0, 1), columns: roled }).find('li')
    expect(card.find('.font-medium').text()).toBe('Léa Martin')
    expect(card.find('p').text()).toBe('CAF Lyon')
    expect(card.text()).not.toContain('12')
  })

  it('joint les sous-titres par un séparateur', () => {
    const card = cards({ rows: rows.slice(0, 1) })
    expect(card.find('p').text()).toBe('12 · CAF Lyon')
  })

  it('remplace la carte entière par le slot card', () => {
    const wrapper = cards({}, { card: '<span class="perso">{{ params.row.name }}</span>' })
    expect(wrapper.findAll('.perso')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('CAF Lyon')
  })
})

describe('DataList — ligne d’ajout rapide', () => {
  it('la rend en tête du tableau avec le nombre de colonnes', () => {
    const wrapper = table(
      {},
      { 'quick-add': '<tr class="ajout"><td>{{ params.columnCount }}</td></tr>' },
    )
    const first = wrapper.find('tbody tr')
    expect(first.classes()).toContain('ajout')
    expect(first.text()).toBe('3')
  })

  it('ne la rend jamais en cartes', () => {
    const wrapper = cards({}, { 'quick-add': '<tr class="ajout"></tr>' })
    expect(wrapper.find('.ajout').exists()).toBe(false)
  })

  it('expose un identifiant d’en-tête qui existe vraiment', () => {
    const wrapper = table(
      {},
      { 'quick-add': '<tr><td><input :aria-labelledby="params.headerId(\'bib\')" /></td></tr>' },
    )
    const target = wrapper.find('input').attributes('aria-labelledby')
    expect(wrapper.find(`#${target}`).text()).toContain('Dossard')
  })

  /**
   * Le glyphe de tri vit dans le même bouton que le libellé : viser le `<th>`
   * donnerait « Dossard↕ » comme nom de champ. Vu en navigateur au Lot 18.
   */
  it('désigne le libellé seul, jamais le glyphe de tri', () => {
    const wrapper = table()
    const labelId = wrapper.find('thead th button span').attributes('id')
    expect(wrapper.find(`#${labelId}`).text()).toBe('Nom')
  })
})

describe('DataList — sélection', () => {
  const selectable = { selectable: true, rowLabel: (row: Climber) => row.name }

  it('étiquette chaque case par le nom de sa ligne', () => {
    const boxes = table(selectable).findAll('input[type="checkbox"]')
    expect(boxes.map((box) => box.attributes('aria-label'))).toEqual([
      'Léa Martin',
      'Éric Dubois',
      'Ana Costa',
    ])
  })

  it('ajoute puis retire une ligne de la sélection', async () => {
    const wrapper = table({ ...selectable, selected: ['a'] })
    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[1]?.trigger('change')
    expect(wrapper.emitted('update:selected')?.[0]).toEqual([['a', 'b']])
    await boxes[0]?.trigger('change')
    expect(wrapper.emitted('update:selected')?.[1]).toEqual([[]])
  })

  it('désactive la case d’une ligne non sélectionnable', () => {
    const wrapper = table({ ...selectable, rowSelectable: (row: Climber) => row.bib !== null })
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes[0]?.attributes('disabled')).toBeUndefined()
    expect(boxes[1]?.attributes('disabled')).toBeDefined()
  })

  it('désactive tout pendant une action en cours', () => {
    const wrapper = table({ ...selectable, busy: true })
    expect(
      wrapper
        .findAll('input[type="checkbox"]')
        .every((box) => box.attributes('disabled') !== undefined),
    ).toBe(true)
  })

  it('ajoute une colonne d’en-tête pour les cases', () => {
    expect(table(selectable).findAll('thead th')).toHaveLength(4)
  })
})

describe('DataList — liste vide', () => {
  it('étale le message sur toutes les colonnes, cases comprises', () => {
    const wrapper = table({ rows: [], selectable: true, emptyText: 'Aucun compétiteur.' })
    const cell = wrapper.find('tbody td')
    expect(cell.attributes('colspan')).toBe('4')
    expect(cell.text()).toBe('Aucun compétiteur.')
  })

  it('rend le slot empty dans les deux dispositions', () => {
    const slots = { empty: '<span class="vide">Rien ici</span>' }
    expect(table({ rows: [] }, slots).find('.vide').exists()).toBe(true)
    expect(cards({ rows: [] }, slots).find('.vide').exists()).toBe(true)
  })
})

describe('DataList — classes de ligne', () => {
  const rowClass = (row: Climber) => (row.bib === null ? 'sans-dossard' : '')

  it('les pose sur la ligne du tableau', () => {
    const rows = table({ rowClass }).findAll('tbody tr')
    expect(rows[1]?.classes()).toContain('sans-dossard')
    expect(rows[0]?.classes()).not.toContain('sans-dossard')
  })

  it('les pose aussi sur la carte', () => {
    expect(cards({ rowClass }).findAll('li')[1]?.classes()).toContain('sans-dossard')
  })
})

describe('DataList — densité (ADR-073)', () => {
  it('compacte les cellules du tableau à la souris seulement', () => {
    const wrapper = table({ selectable: true })
    expect(wrapper.find('tbody th').classes()).toContain('fine:py-1')
    expect(wrapper.find('input[type="checkbox"]').classes()).toContain('fine:size-5')
  })

  it('garde 48 px sur les cartes, quel que soit le pointeur', () => {
    const wrapper = cards()
    expect(wrapper.html()).not.toContain('fine:')
  })
})
