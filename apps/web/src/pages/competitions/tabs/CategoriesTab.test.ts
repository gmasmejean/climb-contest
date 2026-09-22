import type { Category } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Toast } from '@climbcontest/ui'

import { ApiError } from '../../../api/client'
import { stubDesktop } from '../../../test-utils/media-query'

const api = vi.hoisted(() => ({
  categories: {
    list: vi.fn(),
    create: vi.fn(),
    applyTemplate: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
  },
}))
vi.mock('../../../api/competitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/competitions')>()),
  categoriesApi: api.categories,
}))

const { default: CategoriesTab } = await import('./CategoriesTab.vue')

const mounted: VueWrapper[] = []

function aCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
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

const three = [
  aCategory({ id: 'a', label: 'U12 Femme', displayOrder: 0 }),
  aCategory({ id: 'b', label: 'U14 Homme', sex: 'M', displayOrder: 1 }),
  aCategory({ id: 'c', label: 'Sénior', sex: 'X', displayOrder: 2 }),
]

async function mountTab() {
  const wrapper = mount(CategoriesTab, {
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

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)

const rowTexts = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="data-list-row"]').map((row) => row.text())

beforeEach(() => {
  for (const fn of Object.values(api.categories)) fn.mockReset()
  api.categories.list.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('CategoriesTab — disposition', () => {
  it('rend des cartes sur petit écran', async () => {
    api.categories.list.mockResolvedValue(three)
    const wrapper = await mountTab()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(rowTexts(wrapper)).toHaveLength(3)
  })

  it('montre le sexe en colonne sur grand écran, invisible ailleurs', async () => {
    api.categories.list.mockResolvedValue(three)
    expect(rowTexts(await mountTab()).at(-1)).not.toContain('Mixte / libre')

    stubDesktop(true)
    api.categories.list.mockResolvedValue(three)
    const table = await mountTab()
    expect(table.find('table').exists()).toBe(true)
    expect(rowTexts(table).at(-1)).toContain('Mixte / libre')
  })

  it('annonce la liste vide, qui n’existait pas avant', async () => {
    expect((await mountTab()).text()).toContain('Aucune catégorie.')
  })

  it('n’offre aucun tri : l’ordre du déroulé fait foi', async () => {
    stubDesktop(true)
    api.categories.list.mockResolvedValue(three)
    const wrapper = await mountTab()
    expect(wrapper.findAll('thead button')).toHaveLength(0)
    expect(rowTexts(wrapper)[0]).toContain('U12 Femme')
    expect(rowTexts(wrapper).at(-1)).toContain('Sénior')
  })

  it('affiche la tranche d’âge quand elle existe', async () => {
    api.categories.list.mockResolvedValue([aCategory({ birthYearMin: 2010, birthYearMax: 2011 })])
    expect(rowTexts(await mountTab())[0]).toContain('2010–2011')
  })
})

describe('CategoriesTab — réordonnancement', () => {
  beforeEach(() => {
    api.categories.list.mockResolvedValue(three)
    api.categories.reorder.mockResolvedValue(undefined)
  })

  it('désactive les flèches aux extrémités', async () => {
    const wrapper = await mountTab()
    const up = wrapper.findAll('button[aria-label="Monter"]')
    const down = wrapper.findAll('button[aria-label="Descendre"]')
    expect(up[0]?.attributes('disabled')).toBeDefined()
    expect(down.at(-1)?.attributes('disabled')).toBeDefined()
    expect(up[1]?.attributes('disabled')).toBeUndefined()
  })

  it('descend une catégorie dans l’ordre', async () => {
    const wrapper = await mountTab()
    await wrapper.findAll('button[aria-label="Descendre"]')[0]?.trigger('click')
    await flushPromises()
    expect(api.categories.reorder).toHaveBeenCalledWith('comp-1', ['b', 'a', 'c'])
  })

  it('réordonne aussi depuis le tableau', async () => {
    stubDesktop(true)
    const wrapper = await mountTab()
    await wrapper.findAll('button[aria-label="Monter"]')[2]?.trigger('click')
    await flushPromises()
    expect(api.categories.reorder).toHaveBeenCalledWith('comp-1', ['a', 'c', 'b'])
  })
})

describe('CategoriesTab — suppression', () => {
  beforeEach(() => {
    api.categories.list.mockResolvedValue([aCategory()])
  })

  it('demande confirmation avant de supprimer', async () => {
    const wrapper = await mountTab()
    await wrapper.get('button[aria-label="Supprimer"]').trigger('click')
    expect(api.categories.remove).not.toHaveBeenCalled()
    await buttonNamed(wrapper, 'Confirmer')?.trigger('click')
    await flushPromises()
    expect(api.categories.remove).toHaveBeenCalledWith('comp-1', 'cat-1')
  })

  // La protection est entièrement côté serveur : le client ne connaît pas le
  // nombre de compétiteurs rattachés, il relaie le motif du refus tel quel.
  it('relaie le refus du serveur, qui seul connaît les rattachements', async () => {
    api.categories.remove.mockRejectedValue(
      new ApiError(409, 'Conflit', 'Des compétiteurs y sont rattachés.'),
    )
    const toasts = mount(Toast)
    mounted.push(toasts)
    const wrapper = await mountTab()
    await wrapper.get('button[aria-label="Supprimer"]').trigger('click')
    await buttonNamed(wrapper, 'Confirmer')?.trigger('click')
    await flushPromises()
    expect(toasts.text()).toContain('Des compétiteurs y sont rattachés.')
    expect(rowTexts(wrapper)).toHaveLength(1)
  })
})
