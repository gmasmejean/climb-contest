import { mount } from '@vue/test-utils'
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
})
