import { organizerSchema } from '@climbcontest/contracts'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { clearJudgeSession, setJudgeSession } from '../api/judge-session'
import { clearSession, currentUser, setSession } from '../api/session'
import Home from './Home.vue'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn(() => Promise.resolve(undefined)) }))
vi.mock('../api/client', () => ({ apiFetch }))

const organizer = organizerSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  email: 'orga@club.test',
  displayName: 'Orga Test',
  role: 'owner',
  lastLoginAt: null,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  invitedByUserId: null,
  deactivatedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
})

const stub = { template: '<div />' }

async function mountHome(): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Home },
      { path: '/login', name: 'login', component: stub },
      { path: '/competitions', name: 'competition-list', component: stub },
      { path: '/j/home', name: 'judge-home', component: stub },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(Home, { global: { plugins: [router] } })
  return { wrapper, router }
}

/** La carte dont le titre est `title`, quel que soit son élément (lien ou bloc). */
function card(wrapper: VueWrapper, title: string) {
  const li = wrapper.findAll('li').find((item) => item.find('h2').text() === title)
  if (!li) throw new Error(`Carte « ${title} » introuvable`)
  return li
}

describe('Home — page d’accueil publique (ADR-070)', () => {
  beforeEach(() => {
    clearSession()
    clearJudgeSession()
    localStorage.clear()
    apiFetch.mockClear()
  })

  it('anonyme : propose l’espace organisateur et rien de l’état connecté', async () => {
    const { wrapper } = await mountHome()

    const pill = wrapper.find('a[href="/login"]')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toContain('Espace organisateur')
    expect(wrapper.text()).not.toContain('Se déconnecter')
    expect(wrapper.text()).not.toContain('Mes compétitions')
  })

  it('connecté : affiche le nom, le lien « Mes compétitions » et permet la déconnexion', async () => {
    setSession('token', organizer)
    const { wrapper, router } = await mountHome()

    expect(wrapper.text()).toContain('Orga Test')
    const mine = wrapper.find('a[href="/competitions"]')
    expect(mine.exists()).toBe(true)
    // Libellé figé : les tests e2e cliquent ce lien juste après connexion.
    expect(mine.text()).toBe('Mes compétitions')
    expect(wrapper.find('a[href="/login"]').exists()).toBe(false)

    const logout = wrapper.findAll('button').find((b) => b.text() === 'Se déconnecter')
    if (!logout) throw new Error('Bouton « Se déconnecter » introuvable')
    await logout.trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' })
    expect(currentUser.value).toBeNull()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('carte Organisateurs : vers la connexion en anonyme, vers les compétitions en connecté', async () => {
    const anonymous = await mountHome()
    expect(card(anonymous.wrapper, 'Organisateurs').find('a').attributes('href')).toBe('/login')

    setSession('token', organizer)
    const connected = await mountHome()
    expect(card(connected.wrapper, 'Organisateurs').find('a').attributes('href')).toBe(
      '/competitions',
    )
  })

  it('carte Juges : lien vers les voies seulement si un accès juge existe sur l’appareil', async () => {
    const without = await mountHome()
    expect(card(without.wrapper, 'Juges').find('a').exists()).toBe(false)
    expect(card(without.wrapper, 'Juges').text()).not.toContain('→')

    setJudgeSession('jwt-juge')
    const withToken = await mountHome()
    const link = card(withToken.wrapper, 'Juges').find('a')
    expect(link.attributes('href')).toBe('/j/home')
    expect(link.text()).toContain('→')
  })

  it('recherche : désactivée et annoncée comme telle, jamais un champ muet', async () => {
    const { wrapper } = await mountHome()

    const input = wrapper.find('input[type="search"]')
    expect(input.attributes('disabled')).toBeDefined()
    const hintId = input.attributes('aria-describedby')
    if (!hintId) throw new Error('Le champ de recherche n’est pas relié à sa mention')
    expect(wrapper.find(`#${CSS.escape(hintId)}`).text()).toContain('Recherche bientôt disponible')

    const find = wrapper.findAll('button').find((b) => b.text().includes('Trouver une compétition'))
    if (!find) throw new Error('Bouton « Trouver une compétition » introuvable')
    expect(find.attributes('disabled')).toBeDefined()
  })

  it('Spectateurs et Grimpeurs ne sont pas des liens ; Grimpeurs annonce « Bientôt »', async () => {
    const { wrapper } = await mountHome()

    for (const title of ['Spectateurs', 'Grimpeurs']) {
      const c = card(wrapper, title)
      expect(c.find('a').exists()).toBe(false)
      expect(c.text()).not.toContain('→')
    }
    expect(card(wrapper, 'Grimpeurs').text()).toContain('Bientôt')
    expect(card(wrapper, 'Spectateurs').text()).not.toContain('Bientôt')
  })
})
