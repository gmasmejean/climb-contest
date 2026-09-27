import type { Member } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { clearSession, setSession } from '../../api/session'
import OrganizationMembers from './OrganizationMembers.vue'

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

function member(overrides: Partial<Member> & { id: string; displayName: string }): Member {
  return {
    email: `${overrides.id}@club.test`,
    role: 'organizer',
    status: 'active',
    invitationExpiresAt: null,
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  }
}

const me = member({ id: 'me', displayName: 'Alex', role: 'owner' })
const roster = [
  me,
  member({ id: 'camille', displayName: 'Camille' }),
  member({
    id: 'dom',
    displayName: 'Dom',
    status: 'invited',
    invitationExpiresAt: '2026-10-04T10:00:00.000Z',
  }),
]

describe('OrganizationMembers', () => {
  let wrapper: VueWrapper
  let calls: string[]

  function login(role: 'owner' | 'organizer'): void {
    setSession('jeton', {
      id: 'me',
      organizationId: 'o1',
      email: 'me@club.test',
      displayName: 'Alex',
      role,
      lastLoginAt: null,
      emailVerifiedAt: null,
      invitedByUserId: null,
      deactivatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  async function open(): Promise<void> {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/organization/members', component: OrganizationMembers },
        { path: '/competitions', name: 'competition-list', component: { template: '<div />' } },
      ],
    })
    await router.push('/organization/members')
    await router.isReady()
    wrapper = mount(OrganizationMembers, {
      attachTo: document.body,
      global: {
        plugins: [
          router,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
      },
    })
    await flushPromises()
  }

  const card = (name: string) =>
    wrapper.findAll('[data-testid="data-list-row"]').find((li) => li.text().includes(name))
  const button = (name: string, label: string) =>
    card(name)
      ?.findAll('button')
      .find((b) => b.text() === label)
  const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]')
  const dialogButton = (text: string): HTMLButtonElement | undefined =>
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === text)

  beforeEach(() => {
    calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const path = url.replace('/api/v1', '')
        calls.push(`${method} ${path}`)
        if (method === 'GET' && path === '/organization/members')
          return Promise.resolve(json(200, roster))
        if (method === 'DELETE') return Promise.resolve(json(204, null))
        return Promise.resolve(json(200, roster[1]))
      }),
    )
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
    clearSession()
  })

  it('un organizer voit la liste mais aucune action, ni le formulaire d’invitation', async () => {
    login('organizer')
    await open()
    expect(card('Camille')?.text()).toContain('Actif')
    expect(card('Dom')?.text()).toContain('Lien valable jusqu’au 4 octobre')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Seul un propriétaire peut inviter ou gérer les membres.')
    expect(card('Camille')?.find('button').exists()).toBe(false)
  })

  it('un owner n’a aucune action sur sa propre ligne', async () => {
    login('owner')
    await open()
    expect(card('Alex')?.text()).toContain('(vous)')
    expect(card('Alex')?.find('button').exists()).toBe(false)
    expect(button('Camille', 'Rendre propriétaire')).toBeDefined()
    expect(button('Dom', 'Renvoyer l’invitation')).toBeDefined()
  })

  it('désactiver demande une confirmation, puis appelle l’API', async () => {
    login('owner')
    await open()
    await button('Camille', 'Désactiver')?.trigger('click')
    await flushPromises()
    expect(calls).not.toContain('POST /organization/members/camille/deactivate')
    expect(dialog()?.textContent).toContain('Vous pourrez réactiver ce compte à tout moment.')

    dialogButton('Désactiver')?.click()
    await flushPromises()
    expect(calls).toContain('POST /organization/members/camille/deactivate')
  })

  it('« Garder l’invitation » ferme la confirmation sans rien annuler', async () => {
    login('owner')
    await open()
    await button('Dom', 'Annuler l’invitation')?.trigger('click')
    await flushPromises()
    dialogButton('Garder l’invitation')?.click()
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false)
  })

  it('changer un rôle se fait d’un clic : c’est réversible', async () => {
    login('owner')
    await open()
    await button('Camille', 'Rendre propriétaire')?.trigger('click')
    await flushPromises()
    expect(calls).toContain('PATCH /organization/members/camille')
  })

  it('valide l’invitation avant de l’envoyer', async () => {
    login('owner')
    await open()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Le nom est obligatoire.')
    expect(wrapper.text()).toContain('Saisissez une adresse e-mail valide.')
    expect(calls.some((call) => call.includes('/auth/invitations'))).toBe(false)
  })
})
