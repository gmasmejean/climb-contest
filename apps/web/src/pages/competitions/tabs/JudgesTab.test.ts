import type { Competition } from '@climbcontest/contracts'
import { useToast } from '@climbcontest/ui'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createRouter, createWebHistory, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { revealedJudgeTokens, type JudgeWithRoutes } from '../../../api/judges'
import { stubDesktop, stubViewport } from '../../../test-utils/media-query'

const api = vi.hoisted(() => ({
  judges: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    revoke: vi.fn(),
    regeneratePin: vi.fn(),
    resendAccess: vi.fn(),
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
let router: Router

/** Le juge ouvert vit dans `?judge=` (ADR-075) : l'écran a besoin d'un routeur. */
function makeRouter(): Router {
  return createRouter({
    history: createWebHistory(),
    routes: [{ path: '/competitions/:id/:tab?', component: { template: '<div />' } }],
  })
}

function aJudge(overrides: Partial<JudgeWithRoutes> = {}): JudgeWithRoutes {
  return {
    id: 'judge-1',
    competitionId: 'comp-1',
    displayName: 'Bruno',
    email: null,
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

async function mountTab(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  query = '',
) {
  await router.push(`/competitions/comp-1/judges${query}`)
  await router.isReady()
  const wrapper = mount(JudgesTab, {
    attachTo: document.body,
    props: { competition },
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient }]],
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
  router = makeRouter()
  // État au niveau du module (ADR-026) : il survivrait d'un test à l'autre.
  revealedJudgeTokens.value = []
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
    // 1280 px : tableau du Lot 18, sans fiche — le dernier accès y a sa colonne.
    stubViewport(1280)
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
    stubViewport(1280)
    api.judges.list.mockResolvedValue([aJudge(), aJudge({ id: 'judge-2', hasPin: false })])
    const wrapper = await mountTab()
    expect(rowTexts(wrapper)[0]).toContain('Oui')
    expect(rowTexts(wrapper)[1]).toContain('Accès direct')
  })
})

describe('JudgesTab — tri', () => {
  beforeEach(() => {
    // 1280 px : toutes les colonnes triables sont présentes.
    stubViewport(1280)
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

  it('garde les actions sur la carte, sur petit écran', async () => {
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple/j/abc' })])
    const wrapper = await mountTab()

    expect(buttonNamed(wrapper, "Voir l'accès")).toBeDefined()
    expect(buttonNamed(wrapper, 'Régénérer le PIN')).toBeDefined()
    expect(buttonNamed(wrapper, 'Révoquer')).toBeDefined()
    expect(buttonNamed(wrapper, 'Fiche')).toBeUndefined()
    expect(wrapper.find('[data-testid="judge-card"]').exists()).toBe(false)
  })

  it('n’a qu’une action de ligne en tableau : ouvrir la fiche', async () => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple/j/abc' })])
    const wrapper = await mountTab()

    // Les actions ne doivent jamais être aux deux endroits (ADR-074 point 2).
    const row = wrapper.get('[data-testid="data-list-row"]')
    expect(row.text()).not.toContain('Révoquer')
    expect(row.text()).not.toContain('Régénérer le PIN')
    expect(buttonNamed(wrapper, 'Fiche')).toBeDefined()
  })

  it('propose Modifier, sauf pour un juge révoqué', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    expect(buttonNamed(await mountTab(), 'Modifier')).toBeDefined()

    api.judges.list.mockResolvedValue([aJudge({ revokedAt: new Date('2026-01-02T00:00:00Z') })])
    expect(buttonNamed(await mountTab(), 'Modifier')).toBeUndefined()
  })

  it('ne propose de renvoyer les accès que si un e-mail est renseigné', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    expect(buttonNamed(await mountTab(), 'Renvoyer les accès par e-mail')).toBeUndefined()

    api.judges.list.mockResolvedValue([aJudge({ email: 'juge@club-demo.test' })])
    expect(buttonNamed(await mountTab(), 'Renvoyer les accès par e-mail')).toBeDefined()
  })
})

describe('JudgesTab — fiche du juge (Lot 19)', () => {
  beforeEach(() => stubDesktop(true))

  async function openCard(judge: JudgeWithRoutes) {
    api.judges.list.mockResolvedValue([judge])
    api.routes.list.mockResolvedValue([{ id: 'r1', number: 3, name: 'Le dièdre' }])
    const wrapper = await mountTab()
    await buttonNamed(wrapper, 'Fiche')?.trigger('click')
    await flushPromises()
    return wrapper
  }

  it('montre le nom, le statut, les voies et le dernier accès', async () => {
    const wrapper = await openCard(
      aJudge({ routeIds: ['r1'], lastSeenAt: new Date('2026-02-01T10:00:00Z') }),
    )

    const card = wrapper.get('[data-testid="judge-card"]')
    expect(card.text()).toContain('Bruno')
    expect(card.text()).toContain('Actif')
    expect(card.text()).toContain('Voie 3')
    expect(router.currentRoute.value.query.judge).toBe('judge-1')
  })

  it('montre le lien et son QR quand l’accès est conservé', async () => {
    const wrapper = await openCard(aJudge({ accessUrl: 'https://exemple.test/j/abc' }))

    const card = wrapper.get('[data-testid="judge-card"]')
    expect(card.get('input[readonly]').attributes('value')).toBe('https://exemple.test/j/abc')
    expect(card.find('[data-testid="judge-qr-code"]').exists()).toBe(true)
  })

  it('reconstruit le QR d’un juge créé dans cette session, sans accès stocké', async () => {
    revealedJudgeTokens.value = [
      { competitionId: 'comp-1', judgeId: 'judge-1', accessToken: 'jeton-session' },
    ]
    const wrapper = await openCard(aJudge())

    const card = wrapper.get('[data-testid="judge-card"]')
    expect(card.get('input[readonly]').attributes('value')).toContain('/j/jeton-session')
    expect(card.find('[data-testid="judge-qr-code"]').exists()).toBe(true)
  })

  it('ne montre aucun QR sans accès disponible, et dit quoi faire', async () => {
    const wrapper = await openCard(aJudge())

    const card = wrapper.get('[data-testid="judge-card"]')
    expect(card.find('[data-testid="judge-qr-code"]').exists()).toBe(false)
    expect(card.text()).toContain('n’a été montré qu’une fois')
  })

  it('ne montre aucun QR pour un juge révoqué, même avec son jeton en mémoire', async () => {
    revealedJudgeTokens.value = [
      { competitionId: 'comp-1', judgeId: 'judge-1', accessToken: 'jeton-session' },
    ]
    const wrapper = await openCard(aJudge({ revokedAt: new Date('2026-01-02T00:00:00Z') }))

    const card = wrapper.get('[data-testid="judge-card"]')
    expect(card.find('[data-testid="judge-qr-code"]').exists()).toBe(false)
    expect(card.text()).toContain('son lien ne donne plus accès')
    expect(buttonNamed(wrapper, 'Révoquer')).toBeUndefined()
  })

  it('révoque depuis la fiche', async () => {
    api.judges.revoke.mockResolvedValue(undefined)
    const wrapper = await openCard(aJudge())

    await buttonNamed(wrapper, 'Révoquer')?.trigger('click')
    await flushPromises()
    expect(api.judges.revoke).toHaveBeenCalledWith('comp-1', 'judge-1')
  })

  it('perd l’accès de la fiche dès que le serveur cesse de le conserver', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple.test/j/abc' })])
    const wrapper = await mountTab(queryClient)
    await buttonNamed(wrapper, 'Fiche')?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="judge-qr-code"]').exists()).toBe(true)

    // ADR-027 : désactiver la conservation efface le clair côté serveur.
    api.judges.list.mockResolvedValue([aJudge()])
    await queryClient.invalidateQueries({ queryKey: ['competitions', 'comp-1', 'judges'] })
    await flushPromises()

    expect(wrapper.find('[data-testid="judge-qr-code"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="judge-card"]').text()).toContain('n’a été montré qu’une fois')
  })

  it('ouvre la fiche désignée par l’adresse, et ignore un identifiant inconnu', async () => {
    api.judges.list.mockResolvedValue([aJudge()])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const known = await mountTab(queryClient, '?judge=judge-1')
    expect(known.find('[data-testid="judge-card"]').exists()).toBe(true)

    api.judges.list.mockResolvedValue([aJudge()])
    const unknown = await mountTab(
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      '?judge=parti',
    )
    expect(unknown.find('[data-testid="judge-card"]').exists()).toBe(false)
    expect(unknown.text()).toContain('Ajouter un juge')
  })

  it('ne rend aucune fiche sur petit écran : la modale reste', async () => {
    vi.unstubAllGlobals()
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple.test/j/abc' })])
    const wrapper = await mountTab()

    await buttonNamed(wrapper, "Voir l'accès")?.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="judge-card"]').exists()).toBe(false)
    expect(document.body.textContent).toContain('Accès du juge')
  })
})

describe('JudgesTab — édition d’un juge', () => {
  const routeId = '11111111-1111-4111-8111-111111111111'

  it('pré-remplit le panneau et enregistre les modifications', async () => {
    api.judges.list.mockResolvedValue([
      aJudge({ email: 'avant@club-demo.test', routeIds: [routeId] }),
    ])
    api.routes.list.mockResolvedValue([{ id: routeId, number: 3, name: 'Le dièdre' }])
    api.judges.update.mockResolvedValue(aJudge())
    const wrapper = await mountTab()

    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Modifier le juge')
    expect((wrapper.get('input[type="text"]').element as HTMLInputElement).value).toBe('Bruno')
    expect((wrapper.get('input[type="email"]').element as HTMLInputElement).value).toBe(
      'avant@club-demo.test',
    )

    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(api.judges.update).toHaveBeenCalledWith('comp-1', 'judge-1', {
      displayName: 'Bruno',
      routeIds: [routeId],
      email: 'avant@club-demo.test',
    })
  })

  it('modifie depuis la fiche, en maître–détail : l’édition remplace la fiche', async () => {
    stubDesktop(true)
    api.judges.list.mockResolvedValue([aJudge()])
    api.judges.update.mockResolvedValue(aJudge())
    const wrapper = await mountTab()
    await buttonNamed(wrapper, 'Fiche')?.trigger('click')
    await flushPromises()

    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Modifier le juge')
    expect(wrapper.find('[data-testid="judge-card"]').exists()).toBe(false)
  })
})

describe('JudgesTab — renvoi des accès par e-mail', () => {
  it('affiche un toast de succès quand le lien existant a été réutilisé', async () => {
    api.judges.list.mockResolvedValue([aJudge({ email: 'juge@club-demo.test' })])
    api.judges.resendAccess.mockResolvedValue({
      id: 'judge-1',
      accessUrl: 'https://exemple.test/j/abc',
      regenerated: false,
      emailSent: true,
    })
    const wrapper = await mountTab()
    const { toasts } = useToast()
    toasts.splice(0, toasts.length)

    await buttonNamed(wrapper, 'Renvoyer les accès par e-mail')?.trigger('click')
    await flushPromises()

    expect(api.judges.resendAccess).toHaveBeenCalledWith('comp-1', 'judge-1')
    expect(toasts.map((t) => t.text)).toContain('Accès renvoyé par e-mail.')
    expect(document.body.textContent).not.toContain('Nouvel accès envoyé')
  })

  it('ouvre la modale « à noter maintenant » quand l’accès a dû être régénéré', async () => {
    api.judges.list.mockResolvedValue([aJudge({ email: 'juge@club-demo.test' })])
    api.judges.resendAccess.mockResolvedValue({
      id: 'judge-1',
      accessUrl: 'https://exemple.test/j/nouveau',
      regenerated: true,
      emailSent: true,
    })
    const wrapper = await mountTab()

    await buttonNamed(wrapper, 'Renvoyer les accès par e-mail')?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('Nouvel accès envoyé')
    const input = [...document.body.querySelectorAll('input[readonly]')].find(
      (el) => (el as HTMLInputElement).value === 'https://exemple.test/j/nouveau',
    )
    expect(input).toBeDefined()
  })
})

describe('JudgesTab — entre 1024 et 1440 px (ADR-075)', () => {
  it('garde le tableau et ses actions de ligne, sans fiche', async () => {
    // Le tableau tient dès 1024 px, mais pas une fiche à côté : les largeurs
    // fixes du tableau des juges totalisent 528 px.
    stubViewport(1280)
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple.test/j/abc' })])
    const wrapper = await mountTab()

    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('[data-testid="judge-card"]').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Fiche')).toBeUndefined()
    expect(buttonNamed(wrapper, 'Révoquer')).toBeDefined()
    expect(buttonNamed(wrapper, "Voir l'accès")).toBeDefined()
  })

  it('ouvre la modale d’accès au clic, sans fiche à côté', async () => {
    stubViewport(1280)
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple.test/j/abc' })])
    const wrapper = await mountTab()

    await buttonNamed(wrapper, "Voir l'accès")?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Accès du juge')
  })

  it('bascule sur la fiche à 1440 px', async () => {
    stubViewport(1440)
    api.judges.list.mockResolvedValue([aJudge({ accessUrl: 'https://exemple.test/j/abc' })])
    const wrapper = await mountTab()

    expect(buttonNamed(wrapper, 'Fiche')).toBeDefined()
    expect(wrapper.get('[data-testid="data-list-row"]').text()).not.toContain('Révoquer')
  })
})

describe('JudgesTab — colonnes de confort sous 1280 px', () => {
  it('retire le PIN et le dernier accès : sinon le nom du juge disparaît', async () => {
    stubViewport(1024)
    api.judges.list.mockResolvedValue([aJudge({ displayName: 'Bruno Costa' })])
    const wrapper = await mountTab()

    const headers = wrapper.findAll('thead th').map((th) => th.text())
    expect(headers).not.toContain('PIN')
    expect(headers.some((h) => h.startsWith('Dernier accès'))).toBe(false)
    expect(wrapper.get('[data-testid="data-list-row"]').text()).toContain('Bruno Costa')
  })
})
