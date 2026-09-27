import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Register from './Register.vue'

describe('Register', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/register', name: 'register', component: Register },
        { path: '/login', name: 'login', component: { template: '<div />' } },
      ],
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("bloque l'envoi si le mot de passe est trop court, sans appeler l'API", async () => {
    await router.push('/register')
    await router.isReady()
    const wrapper = mount(Register, { global: { plugins: [router] } })

    await wrapper.find('input[type="email"]').setValue('alex@club-demo.test')
    await wrapper.findAll('input[type="text"]')[0]?.setValue('Club Démo')
    await wrapper.findAll('input[type="text"]')[1]?.setValue('Alex')
    await wrapper.find('input[type="password"]').setValue('trop-court')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('mot de passe')
  })

  it('envoie le type d’organisation choisi, « Club » par défaut (ADR-088)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await router.push('/register')
    await router.isReady()
    const wrapper = mount(Register, { global: { plugins: [router] } })

    const select = wrapper.get('select')
    expect((select.element as HTMLSelectElement).value).toBe('club')
    await select.setValue('gym')
    await wrapper.find('input[type="email"]').setValue('alex@bloc-salle.test')
    await wrapper.findAll('input[type="text"]')[0]?.setValue('Bloc Salle')
    await wrapper.findAll('input[type="text"]')[1]?.setValue('Alex')
    await wrapper.find('input[type="password"]').setValue('un-mot-de-passe-solide')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const sent = vi.mocked(fetch).mock.calls[0]?.[1]?.body
    if (typeof sent !== 'string') throw new Error('corps de requête attendu')
    const body: unknown = JSON.parse(sent)
    expect(body).toMatchObject({ organizationName: 'Bloc Salle', organizationType: 'gym' })
  })
})
