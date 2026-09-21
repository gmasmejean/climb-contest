import type { Competition } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { JudgeWithRoutes } from '../../../api/judges'
import { stubDesktop } from '../../../test-utils/media-query'

const api = vi.hoisted(() => ({
  judges: {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
    regeneratePin: vi.fn(),
    downloadQrSheet: vi.fn(),
  },
  routes: { list: vi.fn() },
  competitions: { update: vi.fn() },
}))
vi.mock('../../../api/judges', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/judges')>()),
  judgesApi: api.judges,
}))
vi.mock('../../../api/competitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/competitions')>()),
  routesApi: api.routes,
  competitionsApi: api.competitions,
}))

const { default: JudgesTab } = await import('./JudgesTab.vue')

const mounted: VueWrapper[] = []

function aJudge(overrides: Partial<JudgeWithRoutes> = {}): JudgeWithRoutes {
  return {
    id: 'judge-1',
    competitionId: 'comp-1',
    displayName: 'Bruno',
    accessTokenPrefix: 'abc12345',
    hasPin: true,
    pinAttempts: 0,
    lockedUntil: null,
    revokedAt: null,
    lastSeenAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    routeIds: [],
    ...overrides,
  }
}

const competition = {
  id: 'comp-1',
  publicSlug: 'test',
  judgePinRequired: true,
  judgeCredentialsStored: false,
} as Competition

async function mountTab() {
  const wrapper = mount(JudgesTab, {
    attachTo: document.body,
    props: { competition },
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

const headerNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('thead th').find((th) => th.text().startsWith(label))

const rowTexts = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="data-list-row"]').map((row) => row.text())

beforeEach(() => {
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset()
  api.judges.list.mockResolvedValue([])
  api.routes.list.mockResolvedValue([])
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('JudgesTab — disposition', () => {
  it('rend des cartes sur petit écran', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    const wrapper = await mountTab()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(rowTexts(wrapper)[0]).toContain('Bruno')
  })

  it('rend un tableau avec le dernier accès sur grand écran', async () => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([aJudge()])
    const wrapper = await mountTab()
    expect(headerNamed(wrapper, 'Dernier accès')).toBeDefined()
    expect(rowTexts(wrapper)[0]).toContain('Jamais')
  })

  it('annonce la liste vide', async () => {
    const wrapper = await mountTab()
    expect(wrapper.text()).toContain('Aucun juge.')
  })
})

describe('JudgesTab — statut', () => {
  it('montre un juge actif', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    expect(rowTexts(await mountTab())[0]).toContain('Actif')
  })

  it('montre un juge révoqué', async () => {
    api.judges.list.mockResolvedValue([aJudge({ revokedAt: new Date('2026-01-02T00:00:00Z') })])
    expect(rowTexts(await mountTab())[0]).toContain('Révoqué')
  })

  it('montre un juge bloqué par son PIN', async () => {
    const later = new Date(Date.now() + 60_000)
    api.judges.list.mockResolvedValue([aJudge({ lockedUntil: later })])
    expect(rowTexts(await mountTab())[0]).toContain('Bloqué (PIN)')
  })

  it('signale l’accès sans PIN en pastille sur petit écran', async () => {
    api.judges.list.mockResolvedValue([aJudge({ hasPin: false })])
    expect(rowTexts(await mountTab())[0]).toContain('Accès direct — pas de PIN')
  })

  it('remplit la colonne PIN sur grand écran', async () => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([aJudge(), aJudge({ id: 'judge-2', hasPin: false })])
    const wrapper = await mountTab()
    expect(rowTexts(wrapper)[0]).toContain('Oui')
    expect(rowTexts(wrapper)[1]).toContain('Accès direct')
  })
})

describe('JudgesTab — tri', () => {
  beforeEach(() => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([
      aJudge({ id: 'a', displayName: 'Zoé' }),
      aJudge({ id: 'b', displayName: 'Ana' }),
      aJudge({ id: 'c', displayName: 'élodie' }),
    ])
  })

  it('trie par nom sans tenir compte des accents', async () => {
    const wrapper = await mountTab()
    await headerNamed(wrapper, 'Juge')?.find('button').trigger('click')
    const names = wrapper.findAll('[data-testid="data-list-row"] th').map((cell) => cell.text())
    expect(names).toEqual(['Ana', 'élodie', 'Zoé'])
  })

  it('range les révoqués en tête au tri par statut', async () => {
    api.judges.list.mockResolvedValue([
      aJudge({ id: 'a', displayName: 'Actif' }),
      aJudge({ id: 'b', displayName: 'Parti', revokedAt: new Date('2026-01-02T00:00:00Z') }),
    ])
    const wrapper = await mountTab()
    await headerNamed(wrapper, 'Statut')?.find('button').trigger('click')
    expect(rowTexts(wrapper)[0]).toContain('Parti')
  })

  it('laisse en bas les juges jamais vus, dans les deux sens', async () => {
    api.judges.list.mockResolvedValue([
      aJudge({ id: 'a', displayName: 'Jamais' }),
      aJudge({ id: 'b', displayName: 'Vu', lastSeenAt: new Date('2026-02-01T10:00:00Z') }),
    ])
    const wrapper = await mountTab()
    const header = headerNamed(wrapper, 'Dernier accès')
    await header?.find('button').trigger('click')
    expect(rowTexts(wrapper).at(-1)).toContain('Jamais')
    await header?.find('button').trigger('click')
    expect(rowTexts(wrapper).at(-1)).toContain('Jamais')
  })
})

describe('JudgesTab — actions de ligne', () => {
  it('ne propose « Voir l’accès » que si l’accès est conservé', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    expect(buttonNamed(await mountTab(), "Voir l'accès")).toBeUndefined()

    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple/j/abc' })])
    expect(buttonNamed(await mountTab(), "Voir l'accès")).toBeDefined()
  })

  it('ne propose pas de régénérer le PIN d’un juge révoqué', async () => {
    api.judges.list.mockResolvedValue([aJudge({ revokedAt: new Date('2026-01-02T00:00:00Z') })])
    const wrapper = await mountTab()
    expect(buttonNamed(wrapper, 'Régénérer le PIN')).toBeUndefined()
    expect(buttonNamed(wrapper, 'Révoquer')).toBeUndefined()
  })

  it('révoque depuis le tableau', async () => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([aJudge()])
    api.judges.revoke.mockResolvedValue(undefined)
    const wrapper = await mountTab()
    await buttonNamed(wrapper, 'Révoquer')?.trigger('click')
    await flushPromises()
    expect(api.judges.revoke).toHaveBeenCalledWith('comp-1', 'judge-1')
  })
})
