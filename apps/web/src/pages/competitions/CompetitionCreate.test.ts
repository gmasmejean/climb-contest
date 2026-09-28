import type { OrganizationProfile } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { clearSession, setSession } from '../../api/session'
import CompetitionCreate from './CompetitionCreate.vue'

vi.mock('../../lib/leaflet-map', () => ({
  createLocationMap: vi.fn(() => ({ destroy: vi.fn() })),
}))

const address = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
  banId: '80021_6590_00008',
}
const profileWithAddress: OrganizationProfile = {
  id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  name: 'Roc’n Bloc',
  type: 'gym',
  description: null,
  contactEmail: null,
  contactPhone: null,
  websiteUrl: null,
  address,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let profile: OrganizationProfile = { ...profileWithAddress, address: null }
let posts: unknown[] = []

// Démontés après chaque test : sinon un changement de session (rôle) fait
// réagir les pages des tests précédents, montées avec d'autres routeurs.
const mounted: { unmount: () => void }[] = []

function mountCreate(router: ReturnType<typeof createRouter>) {
  const wrapper = mount(CompetitionCreate, {
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
  mounted.push(wrapper)
  return wrapper
}

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
    profile = { ...profileWithAddress, address: null }
    posts = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/api/v1/organization')) return Promise.resolve(json(200, profile))
        if (init?.method === 'POST' && typeof init.body === 'string') {
          posts.push(JSON.parse(init.body))
          return Promise.resolve(json(201, { id: 'c1' }))
        }
        return Promise.reject(new TypeError(`inattendu : ${url}`))
      }),
    )
    localStorage.clear()
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    vi.unstubAllGlobals()
    clearSession()
  })

  it("bloque l'envoi si la date de fin précède la date de début, sans appeler l'API", async () => {
    await router.push('/competitions/new')
    await router.isReady()
    const wrapper = mountCreate(router)

    await wrapper.find('input[type="text"]').setValue('Coupe du club')
    await wrapper.findAll('input[type="text"]')[1]?.setValue('Salle Roc')
    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0]?.setValue('2026-06-10')
    await dateInputs[1]?.setValue('2026-06-01')
    await wrapper.find('form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(posts).toEqual([])
    expect(wrapper.text()).toContain('postérieure')
  })

  it('affiche le champ « nombre de voies comptées » seulement en format contest', async () => {
    await router.push('/competitions/new')
    await router.isReady()
    const wrapper = mountCreate(router)

    expect(wrapper.text()).toContain('Nombre de voies comptées')
    await wrapper.find('select').setValue('phases')
    expect(wrapper.text()).not.toContain('Nombre de voies comptées')
  })

  describe('date de fin', () => {
    async function open() {
      await router.push('/competitions/new')
      await router.isReady()
      return mountCreate(router)
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

  describe('lieu (ADR-089)', () => {
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

    async function open() {
      router.addRoute({
        path: '/organization',
        name: 'organization-profile',
        component: { template: '<div />' },
      })
      await router.push('/competitions/new')
      await router.isReady()
      const wrapper = mountCreate(router)
      await flushPromises()
      return wrapper
    }

    async function fillDates(wrapper: Awaited<ReturnType<typeof open>>) {
      await wrapper.find('input[type="text"]').setValue('Open de bloc')
      const [startsOn] = wrapper.findAll('input[type="date"]')
      await startsOn?.setValue('2026-06-10')
    }

    it('propose le lieu de l’organisation et le recopie dans la compétition créée', async () => {
      profile = profileWithAddress
      const wrapper = await open()
      const organization = wrapper.get<HTMLInputElement>(
        'input[type="radio"][value="organization"]',
      )
      expect(organization.element.checked).toBe(true)
      expect(wrapper.text()).toContain('Roc’n Bloc — 8 Boulevard du Port 80000 Amiens')

      await fillDates(wrapper)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(posts[0]).toMatchObject({ venue: 'Roc’n Bloc', address })
    })

    it('un autre lieu : le nom est à saisir, l’adresse est facultative', async () => {
      profile = profileWithAddress
      const wrapper = await open()
      await wrapper.get('input[type="radio"][value="other"]').setValue(true)
      const venue = wrapper.findAll('input[type="text"]')[1]
      await venue?.setValue('Gymnase Jules-Verne')
      const combobox = wrapper.get('input[role="combobox"]')
      await combobox.setValue('')

      await fillDates(wrapper)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(posts[0]).toMatchObject({ venue: 'Gymnase Jules-Verne', address: null })
    })

    it('organisation sans adresse : saisie ouverte et lien vers la fiche pour un owner', async () => {
      login('owner')
      const wrapper = await open()
      expect(wrapper.find('input[type="radio"]').exists()).toBe(false)
      const note = wrapper.get('[data-testid="no-organization-address"]')
      expect(note.text()).toContain('Votre organisation n’a pas encore d’adresse.')
      expect(note.get('a').attributes('href')).toBe('/organization')
      expect(wrapper.find('input[role="combobox"]').exists()).toBe(true)
    })

    it('organisation sans adresse : un organizer apprend qu’un propriétaire peut la renseigner', async () => {
      login('organizer')
      const wrapper = await open()
      const note = wrapper.get('[data-testid="no-organization-address"]')
      expect(note.find('a').exists()).toBe(false)
      expect(note.text()).toContain('Un propriétaire peut la renseigner')
    })

    it('un brouillon restauré garde son lieu, même si l’organisation en a un', async () => {
      profile = profileWithAddress
      localStorage.setItem(
        'climbcontest:draft:competition-create',
        JSON.stringify({ placeChoice: 'other', venue: 'Salle des fêtes', address: null }),
      )
      const wrapper = await open()
      expect(
        wrapper.get<HTMLInputElement>('input[type="radio"][value="other"]').element.checked,
      ).toBe(true)
      expect(
        wrapper
          .findAll<HTMLInputElement>('input[type="text"]')
          .some((input) => input.element.value === 'Salle des fêtes'),
      ).toBe(true)
    })
  })
})
