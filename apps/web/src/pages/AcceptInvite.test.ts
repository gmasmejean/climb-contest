import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { clearSession, currentUser } from '../api/session'
import AcceptInvite from './AcceptInvite.vue'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('AcceptInvite', () => {
  let router: ReturnType<typeof createRouter>
  let fetchMock: ReturnType<typeof vi.fn>

  async function open(query = '?token=jeton-invitation') {
    await router.push(`/accept-invite${query}`)
    await router.isReady()
    const wrapper = mount(AcceptInvite, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/accept-invite', name: 'accept-invite', component: AcceptInvite },
        { path: '/competitions', name: 'competition-list', component: { template: '<div />' } },
      ],
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    clearSession()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retire le jeton de l’adresse sans rien envoyer au chargement (ADR-020)', async () => {
    await open()
    expect(router.currentRoute.value.fullPath).toBe('/accept-invite')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('active le compte avec le mot de passe choisi, ouvre la session et mène aux compétitions', async () => {
    fetchMock.mockResolvedValue(
      json(201, {
        accessToken: 'jeton-acces',
        user: { id: 'u1', displayName: 'Camille', role: 'organizer', organizationId: 'o1' },
      }),
    )
    const wrapper = await open()
    await wrapper.find('input[type="password"]').setValue('un-mot-de-passe-solide')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/auth/invitations/accept')
    expect(JSON.parse(init.body as string)).toEqual({
      token: 'jeton-invitation',
      password: 'un-mot-de-passe-solide',
    })
    expect(currentUser.value?.displayName).toBe('Camille')
    expect(router.currentRoute.value.name).toBe('competition-list')
  })

  it('refuse un mot de passe trop court sans appeler l’API', async () => {
    const wrapper = await open()
    await wrapper.find('input[type="password"]').setValue('court')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('au moins 12 caractères')
  })

  it('une invitation expirée dit à qui s’adresser', async () => {
    fetchMock.mockResolvedValue(
      json(400, {
        title: 'Invitation expirée',
        detail: 'Cette invitation a expiré — demandez-en une nouvelle.',
      }),
    )
    const wrapper = await open()
    await wrapper.find('input[type="password"]').setValue('un-mot-de-passe-solide')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain(
      'Demandez à la personne qui vous a invité de vous renvoyer une invitation.',
    )
    expect(router.currentRoute.value.name).toBe('accept-invite')
  })

  it('sans jeton, dit que le lien est incomplet au lieu d’un formulaire inutile', async () => {
    const wrapper = await open('')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Ce lien d’invitation est incomplet')
  })
})
