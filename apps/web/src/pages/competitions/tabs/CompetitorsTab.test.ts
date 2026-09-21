import type { Category, Competitor } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubDesktop } from '../../../test-utils/media-query'

const api = vi.hoisted(() => ({
  competitors: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    changeStatus: vi.fn(),
    assignBibs: vi.fn(),
  },
  categories: { list: vi.fn() },
}))
vi.mock('../../../api/competitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/competitions')>()),
  competitorsApi: api.competitors,
  categoriesApi: api.categories,
}))

const { default: CompetitorsTab } = await import('./CompetitorsTab.vue')

const mounted: VueWrapper[] = []

/** `createCompetitorInputSchema` exige des UUID : des identifiants courts échoueraient. */
const CAT_A = '11111111-1111-4111-8111-111111111111'
const CAT_B = '22222222-2222-4222-8222-222222222222'

function aCompetitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: 'competitor-1',
    competitionId: 'comp-1',
    categoryId: CAT_A,
    bib: 1,
    firstName: 'Léa',
    lastName: 'Martin',
    birthYear: 2008,
    clubName: 'CAF Lyon',
    licenseNumber: null,
    status: 'registered',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function aCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: CAT_A,
    competitionId: 'comp-1',
    label: 'U16 Femme',
    sex: 'F',
    birthYearMin: null,
    birthYearMax: null,
    displayOrder: 0,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

async function mountTab() {
  const wrapper = mount(CompetitorsTab, {
    attachTo: document.body,
    props: { competitionId: 'comp-1' },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

function fieldByLabel(wrapper: VueWrapper, label: string) {
  const id = wrapper
    .findAll('label')
    .find((element) => element.text() === label)
    ?.attributes('for')
  return wrapper.get(`#${id ?? 'introuvable'}`)
}

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)

const headerNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('thead th').find((th) => th.text().startsWith(label))

const rowTexts = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="data-list-row"]').map((row) => row.text())

beforeEach(() => {
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset()
  api.competitors.list.mockResolvedValue([])
  api.categories.list.mockResolvedValue([aCategory()])
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('CompetitorsTab — disposition', () => {
  it('rend des cartes sur petit écran', async () => {
    api.competitors.list.mockResolvedValue([aCompetitor()])
    const wrapper = await mountTab()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('[data-testid="data-list-row"]').text()).toContain('1 — Léa Martin')
  })

  it('rend un tableau sur grand écran', async () => {
    stubDesktop(true)
    api.competitors.list.mockResolvedValue([aCompetitor()])
    const wrapper = await mountTab()
    expect(wrapper.find('table').exists()).toBe(true)
    expect(headerNamed(wrapper, 'Dossard')).toBeDefined()
    expect(headerNamed(wrapper, 'Club')).toBeDefined()
  })

  it('ne montre qu’un seul chemin d’ajout à la fois', async () => {
    const small = await mountTab()
    expect(small.text()).toContain('Ajouter un compétiteur')
    expect(small.find('tbody').exists()).toBe(false)

    stubDesktop(true)
    const large = await mountTab()
    expect(large.text()).not.toContain('Ajouter un compétiteur')
    expect(large.find('tbody tr').exists()).toBe(true)
  })
})

describe('CompetitorsTab — recherche et filtre', () => {
  const lea = aCompetitor({ id: 'a', bib: 12, firstName: 'Léa', lastName: 'Martin' })
  const bruno = aCompetitor({
    id: 'b',
    bib: 34,
    firstName: 'Bruno',
    lastName: 'Costa',
    categoryId: CAT_B,
  })

  beforeEach(() => {
    api.competitors.list.mockResolvedValue([lea, bruno])
    api.categories.list.mockResolvedValue([
      aCategory(),
      aCategory({ id: CAT_B, label: 'U18 Homme' }),
    ])
  })

  it('filtre sur le nom', async () => {
    const wrapper = await mountTab()
    await fieldByLabel(wrapper, 'Rechercher (nom ou dossard)').setValue('costa')
    expect(rowTexts(wrapper)).toHaveLength(1)
    expect(rowTexts(wrapper)[0]).toContain('Bruno Costa')
  })

  it('filtre sur le dossard', async () => {
    const wrapper = await mountTab()
    await fieldByLabel(wrapper, 'Rechercher (nom ou dossard)').setValue('12')
    expect(rowTexts(wrapper)).toHaveLength(1)
    expect(rowTexts(wrapper)[0]).toContain('Léa Martin')
  })

  it('filtre par catégorie', async () => {
    const wrapper = await mountTab()
    await fieldByLabel(wrapper, 'Filtrer par catégorie').setValue(CAT_B)
    expect(rowTexts(wrapper)).toHaveLength(1)
    expect(rowTexts(wrapper)[0]).toContain('Bruno Costa')
  })

  it('annonce la liste vide', async () => {
    const wrapper = await mountTab()
    await fieldByLabel(wrapper, 'Rechercher (nom ou dossard)').setValue('personne')
    expect(wrapper.text()).toContain('Aucun compétiteur.')
  })
})

describe('CompetitorsTab — tri', () => {
  beforeEach(() => {
    stubDesktop(true)
    api.competitors.list.mockResolvedValue([
      aCompetitor({ id: 'a', bib: 12, firstName: 'Léa', lastName: 'Martin' }),
      aCompetitor({ id: 'b', bib: null, firstName: 'Bruno', lastName: 'Costa' }),
      aCompetitor({ id: 'c', bib: 3, firstName: 'Ana', lastName: 'Abad' }),
    ])
  })

  it('trie par nom au clic sur l’en-tête', async () => {
    const wrapper = await mountTab()
    await headerNamed(wrapper, 'Nom')?.find('button').trigger('click')
    expect(rowTexts(wrapper).map((text) => text.slice(0, 20))).toEqual([
      expect.stringContaining('Abad'),
      expect.stringContaining('Costa'),
      expect.stringContaining('Martin'),
    ])
  })

  it('inverse le tri au second clic', async () => {
    const wrapper = await mountTab()
    const header = headerNamed(wrapper, 'Nom')
    await header?.find('button').trigger('click')
    await header?.find('button').trigger('click')
    expect(header?.attributes('aria-sort')).toBe('descending')
    expect(rowTexts(wrapper)[0]).toContain('Martin')
  })

  it('laisse les dossards non attribués en bas dans les deux sens', async () => {
    const wrapper = await mountTab()
    const header = headerNamed(wrapper, 'Dossard')
    await header?.find('button').trigger('click')
    expect(rowTexts(wrapper).at(-1)).toContain('Bruno')
    await header?.find('button').trigger('click')
    expect(rowTexts(wrapper).at(-1)).toContain('Bruno')
  })
})

describe('CompetitorsTab — ligne d’ajout rapide', () => {
  beforeEach(() => {
    stubDesktop(true)
    api.competitors.create.mockResolvedValue(aCompetitor())
  })

  /** Les champs de la ligne d'ajout, dans l'ordre des colonnes. */
  function quickAdd(wrapper: VueWrapper) {
    const row = wrapper.get('tbody tr')
    return {
      bib: row.findAll('input[type="number"]')[0],
      firstName: row.findAll('input[type="text"]')[0],
      lastName: row.findAll('input[type="text"]')[1],
      category: row.get('select'),
      club: row.findAll('input[type="text"]')[2],
    }
  }

  it('ajoute au clavier avec Entrée', async () => {
    const wrapper = await mountTab()
    const fields = quickAdd(wrapper)
    await fields.firstName?.setValue('Ana')
    await fields.lastName?.setValue('Costa')
    await fields.category.setValue(CAT_A)
    await fields.firstName?.trigger('keydown.enter')
    await flushPromises()
    expect(api.competitors.create).toHaveBeenCalledWith(
      'comp-1',
      expect.objectContaining({ firstName: 'Ana', lastName: 'Costa', categoryId: CAT_A }),
    )
  })

  it('vide le nom mais garde la catégorie et le club', async () => {
    const wrapper = await mountTab()
    const fields = quickAdd(wrapper)
    await fields.firstName?.setValue('Ana')
    await fields.lastName?.setValue('Costa')
    await fields.category.setValue(CAT_A)
    await fields.club?.setValue('CAF Lyon')
    await fields.firstName?.trigger('keydown.enter')
    await flushPromises()
    const after = quickAdd(wrapper)
    expect((after.firstName?.element as HTMLInputElement).value).toBe('')
    expect((after.lastName?.element as HTMLInputElement).value).toBe('')
    expect((after.category.element as HTMLSelectElement).value).toBe(CAT_A)
    expect((after.club?.element as HTMLInputElement).value).toBe('CAF Lyon')
  })

  it('rend le focus au prénom pour enchaîner', async () => {
    const wrapper = await mountTab()
    const fields = quickAdd(wrapper)
    await fields.firstName?.setValue('Ana')
    await fields.lastName?.setValue('Costa')
    await fields.category.setValue(CAT_A)
    await fields.firstName?.trigger('keydown.enter')
    await flushPromises()
    expect(document.activeElement).toBe(quickAdd(wrapper).firstName?.element)
  })

  it('refuse une ligne incomplète et l’annonce sans rien envoyer', async () => {
    const wrapper = await mountTab()
    await quickAdd(wrapper).firstName?.setValue('Ana')
    await quickAdd(wrapper).firstName?.trigger('keydown.enter')
    await flushPromises()
    expect(api.competitors.create).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('abandonne la ligne avec Échap', async () => {
    const wrapper = await mountTab()
    await quickAdd(wrapper).firstName?.setValue('Ana')
    await quickAdd(wrapper).firstName?.trigger('keydown.esc')
    expect((quickAdd(wrapper).firstName?.element as HTMLInputElement).value).toBe('')
  })

  it('n’existe pas sur petit écran', async () => {
    vi.unstubAllGlobals()
    const wrapper = await mountTab()
    expect(wrapper.find('tbody').exists()).toBe(false)
  })
})

describe('CompetitorsTab — édition et retrait', () => {
  beforeEach(() => {
    api.competitors.list.mockResolvedValue([aCompetitor()])
    api.competitors.update.mockResolvedValue(aCompetitor({ bib: 7 }))
    api.competitors.remove.mockResolvedValue(undefined)
  })

  it('enregistre un dossard modifié en place', async () => {
    stubDesktop(true)
    const wrapper = await mountTab()
    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    const field = wrapper.get('[data-testid="data-list-row"] input[type="number"]')
    await field.setValue('7')
    await buttonNamed(wrapper, 'Enregistrer')?.trigger('click')
    await flushPromises()
    expect(api.competitors.update).toHaveBeenCalledWith(
      'comp-1',
      'competitor-1',
      expect.objectContaining({ bib: 7 }),
    )
  })

  it('demande confirmation avant de retirer', async () => {
    const wrapper = await mountTab()
    await buttonNamed(wrapper, 'Retirer')?.trigger('click')
    expect(api.competitors.remove).not.toHaveBeenCalled()
    await buttonNamed(wrapper, 'Confirmer')?.trigger('click')
    await flushPromises()
    expect(api.competitors.remove).toHaveBeenCalledWith('comp-1', 'competitor-1')
  })
})
