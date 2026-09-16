import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import CompetitionCreate from './CompetitionCreate.vue'

describe('CompetitionCreate', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/competitions/new', name: 'competition-create', component: CompetitionCreate },
        {
          path: '/competitions/:id',
          name: 'competition-detail',
          component: { template: '<div />' },
        },
      ],
    })
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("bloque l'envoi si la date de fin précède la date de début, sans appeler l'API", async () => {
    await router.push('/competitions/new')
    await router.isReady()
    const wrapper = mount(CompetitionCreate, { global: { plugins: [router] } })

    await wrapper.find('input[type="text"]').setValue('Coupe du club')
    await wrapper.findAll('input[type="text"]')[1]?.setValue('Salle Roc')
    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0]?.setValue('2026-06-10')
    await dateInputs[1]?.setValue('2026-06-01')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(fetch).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('postérieure')
  })

  it('affiche le champ « nombre de voies comptées » seulement en format contest', async () => {
    await router.push('/competitions/new')
    await router.isReady()
    const wrapper = mount(CompetitionCreate, { global: { plugins: [router] } })

    expect(wrapper.text()).toContain('Nombre de voies comptées')
    await wrapper.find('select').setValue('phases')
    expect(wrapper.text()).not.toContain('Nombre de voies comptées')
  })
})
