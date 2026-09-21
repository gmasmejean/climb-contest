import { organizerSchema } from '@climbcontest/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Page components are lazy-loaded by the router; stub the ones we navigate to
// so this test exercises the guard only, not the pages' own imports.
const stub = { default: { template: '<div />' } }
vi.mock('./pages/competitions/CompetitionDetail.vue', () => stub)
vi.mock('./pages/competitions/CompetitionList.vue', () => stub)
vi.mock('./pages/Home.vue', () => stub)
vi.mock('./pages/Login.vue', () => stub)
vi.mock('./pages/public/PublicCompetition.vue', () => stub)
vi.mock('./pages/public/PublicRoomScreen.vue', () => stub)
vi.mock('./pages/judge/JudgeAccess.vue', () => stub)
vi.mock('./pages/judge/JudgeLayout.vue', () => ({ default: { template: '<router-view />' } }))
vi.mock('./pages/judge/JudgeHome.vue', () => stub)

const organizer = organizerSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  clubId: '00000000-0000-4000-8000-000000000002',
  email: 'orga@club.test',
  displayName: 'Orga Test',
  role: 'owner',
  lastLoginAt: null,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  invitedByUserId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
})

/** Fresh router + session state per test: `bootstrapped` lives at module scope. */
async function freshRouter(options: { refreshSucceeds: boolean }) {
  vi.resetModules()
  const session = await import('./api/session')
  const bootstrapSession = vi.fn(() => {
    if (options.refreshSucceeds) {
      session.setSession('token', organizer)
      return Promise.resolve(true)
    }
    return Promise.resolve(false)
  })
  vi.doMock('./api/client', () => ({ bootstrapSession }))
  const { default: router } = await import('./router')
  return { router, bootstrapSession }
}

describe('router — restauration de la session au chargement direct (F5)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reste sur /competitions/:id quand la session est restaurable', async () => {
    const { router, bootstrapSession } = await freshRouter({ refreshSucceeds: true })

    await router.push('/competitions/abc')

    expect(bootstrapSession).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe('/competitions/abc')
  })

  it('reste sur /competitions (liste) quand la session est restaurable', async () => {
    const { router } = await freshRouter({ refreshSucceeds: true })

    await router.push('/competitions')

    expect(router.currentRoute.value.fullPath).toBe('/competitions')
  })

  it('renvoie vers /login, pas vers /, quand aucune session ne peut être restaurée', async () => {
    const { router } = await freshRouter({ refreshSucceeds: false })

    await router.push('/competitions/abc')

    expect(router.currentRoute.value.name).toBe('login')
  })

  it('ne tente jamais de restaurer une session organisateur sur la page publique', async () => {
    const { router, bootstrapSession } = await freshRouter({ refreshSucceeds: true })

    await router.push('/c/un-slug')

    expect(bootstrapSession).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe('/c/un-slug')
  })

  it("ne tente jamais de restaurer une session organisateur sur l'écran de salle", async () => {
    const { router, bootstrapSession } = await freshRouter({ refreshSucceeds: true })

    await router.push('/c/un-slug/salle')

    expect(bootstrapSession).not.toHaveBeenCalled()
  })

  it('ne tente jamais de restaurer une session organisateur sur les écrans juge', async () => {
    const { router, bootstrapSession } = await freshRouter({ refreshSucceeds: true })

    await router.push('/j/home')
    expect(bootstrapSession).not.toHaveBeenCalled()

    await router.push('/j/un-token')
    expect(bootstrapSession).not.toHaveBeenCalled()
  })

  // ADR-070 : `/` est publique (pas de `requiresAuth`) mais restaure la
  // session organisateur (pas de `skipOrganizerSession`) pour l'en-tête.
  it("affiche l'accueil sans session, après avoir tenté de la restaurer", async () => {
    const { router, bootstrapSession } = await freshRouter({ refreshSucceeds: false })

    await router.push('/')

    expect(bootstrapSession).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it("reste sur l'accueil quand la session est restaurable", async () => {
    const { router } = await freshRouter({ refreshSucceeds: true })

    await router.push('/')

    expect(router.currentRoute.value.fullPath).toBe('/')
  })
})

describe('router — onglet de la page compétition dans l’URL (ADR-072)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('ouvre directement un onglet connu', async () => {
    const { router } = await freshRouter({ refreshSucceeds: true })

    await router.push('/competitions/abc/routes')

    expect(router.currentRoute.value.name).toBe('competition-detail')
    expect(router.currentRoute.value.params).toEqual({ id: 'abc', tab: 'routes' })
  })

  it('retire un segment d’onglet inconnu et reste sur la compétition', async () => {
    const { router } = await freshRouter({ refreshSucceeds: true })

    await router.push('/competitions/abc/nimporte-quoi')

    expect(router.currentRoute.value.fullPath).toBe('/competitions/abc')
  })

  it('ne confond pas « new » et « trash » avec un identifiant de compétition', async () => {
    const { router } = await freshRouter({ refreshSucceeds: true })

    await router.push('/competitions/new')
    expect(router.currentRoute.value.name).toBe('competition-create')

    await router.push('/competitions/trash')
    expect(router.currentRoute.value.name).toBe('competition-trash')
  })

  it('protège aussi les onglets derrière la connexion', async () => {
    const { router } = await freshRouter({ refreshSucceeds: false })

    await router.push('/competitions/abc/pilotage')

    expect(router.currentRoute.value.name).toBe('login')
  })
})
