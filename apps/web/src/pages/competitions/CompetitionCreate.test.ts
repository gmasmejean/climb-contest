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

  describe('date de fin', () => {
    async function open() {
      await router.push('/competitions/new')
      await router.isReady()
      return mount(CompetitionCreate, { global: { plugins: [router] } })
    }

    it('suit la date de début quand celle-ci change', async () => {
      const wrapper = await open()
      const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

      await startsOn?.setValue('2026-06-10')
      expect(endsOn?.element.value).toBe('2026-06-10')

      await startsOn?.setValue('2026-06-12')
      expect(endsOn?.element.value).toBe('2026-06-12')
    })

    it('reste modifiable à la main après la date de début', async () => {
      const wrapper = await open()
      const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

      await startsOn?.setValue('2026-06-10')
      await endsOn?.setValue('2026-06-11')

      expect(endsOn?.element.value).toBe('2026-06-11')
      expect(startsOn?.element.value).toBe('2026-06-10')
    })

    it('ignore une saisie partielle (champ date vidé)', async () => {
      const wrapper = await open()
      const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

      await startsOn?.setValue('2026-06-10')
      await startsOn?.setValue('')

      expect(endsOn?.element.value).toBe('2026-06-10')
    })

    it('ne touche pas à la date de fin d’un brouillon restauré', async () => {
      localStorage.setItem(
        'climbcontest:draft:competition-create',
        JSON.stringify({ startsOn: '2026-06-10', endsOn: '2026-06-11' }),
      )
      const wrapper = await open()
      await wrapper.vm.$nextTick()
      const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

      expect(startsOn?.element.value).toBe('2026-06-10')
      expect(endsOn?.element.value).toBe('2026-06-11')
    })
  })
})
