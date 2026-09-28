import type { OrganizationProfile as Profile } from '@climbcontest/contracts'
import { useToast } from '@climbcontest/ui'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { clearSession, setSession } from '../../api/session'
import OrganizationProfile from './OrganizationProfile.vue'

vi.mock('../../lib/leaflet-map', () => ({
  createLocationMap: vi.fn(() => ({ destroy: vi.fn() })),
}))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stored: Profile = {
  id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
  name: 'Club Roc',
  type: 'club',
  description: 'Salle de bloc.',
  contactEmail: 'contact@club-roc.test',
  contactPhone: null,
  websiteUrl: null,
  address: {
    label: '8 Boulevard du Port 80000 Amiens',
    postcode: '80000',
    city: 'Amiens',
    latitude: 49.897442,
    longitude: 2.290084,
    banId: '80021_6590_00008',
  },
}

describe('OrganizationProfile', () => {
  let wrapper: VueWrapper
  let patches: unknown[]
  let patchResponse: (body: unknown) => Response
  let photoList: { id: string; altText: string | null }[]

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
        { path: '/organization', component: OrganizationProfile },
        { path: '/competitions', name: 'competition-list', component: { template: '<div />' } },
      ],
    })
    await router.push('/organization')
    await router.isReady()
    wrapper = mount(OrganizationProfile, {
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

  const field = (label: string) => {
    const id = wrapper
      .findAll('label')
      .find((l) => l.text().replace('*', '').trim() === label)
      ?.attributes('for')
    return wrapper.get(`#${id}`)
  }

  beforeEach(() => {
    patches = []
    photoList = []
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }),
    )
    patchResponse = (body) => json(200, { ...stored, ...(body as object) })
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (url.endsWith('/api/v1/organization') && method === 'GET') {
          return Promise.resolve(json(200, stored))
        }
        if (url.endsWith('/api/v1/organization/photos') && method === 'GET') {
          return Promise.resolve(json(200, photoList))
        }
        if (url.includes('/api/v1/organization/photos/') && method === 'GET') {
          return Promise.resolve(new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 }))
        }
        if (url.endsWith('/api/v1/organization') && method === 'PATCH') {
          if (typeof init?.body !== 'string') throw new Error('corps de requête attendu')
          const body: unknown = JSON.parse(init.body)
          patches.push(body)
          return Promise.resolve(patchResponse(body))
        }
        return Promise.reject(new TypeError(`inattendu : ${method} ${url}`))
      }),
    )
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
    clearSession()
  })

  it('un owner retrouve la fiche enregistrée dans le formulaire, avec l’avertissement RGPD', async () => {
    login('owner')
    await open()
    expect((field('Nom').element as HTMLInputElement).value).toBe('Club Roc')
    expect((field('Description').element as HTMLTextAreaElement).value).toBe('Salle de bloc.')
    expect((field('Adresse').element as HTMLInputElement).value).toBe(
      '8 Boulevard du Port 80000 Amiens',
    )
    expect(wrapper.get('[data-testid="public-contact-warning"]').text()).toContain(
      'visibles de tous sur la page publique',
    )
  })

  it('enregistre : un champ vidé part en null, un site sans préfixe reçoit https://', async () => {
    login('owner')
    await open()
    await field('Description').setValue('   ')
    await field('Téléphone').setValue('03 22 00 00 00')
    await field('Site web').setValue('www.club-roc.test')
    await field('Type').setValue('gym')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patches).toEqual([
      {
        name: 'Club Roc',
        type: 'gym',
        description: null,
        contactEmail: 'contact@club-roc.test',
        contactPhone: '03 22 00 00 00',
        websiteUrl: 'https://www.club-roc.test',
        address: stored.address,
      },
    ])
    expect(useToast().toasts.map((toast) => toast.text)).toContain('Fiche enregistrée.')
  })

  it('signale un champ invalide sans rien envoyer', async () => {
    login('owner')
    await open()
    await field('Site web').setValue('http://club-roc.test')
    await field('Nom').setValue('  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patches).toEqual([])
    expect(wrapper.text()).toContain('Adresse du site invalide : elle doit commencer par https://.')
    expect(wrapper.text()).toContain('Indiquez le nom de l’organisation.')
  })

  it('montre le refus du serveur tel quel', async () => {
    login('owner')
    patchResponse = () =>
      json(403, {
        title: 'Accès refusé',
        detail: 'Seul le propriétaire de l’organisation peut effectuer cette action.',
      })
    await open()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(
      'Seul le propriétaire de l’organisation peut effectuer cette action.',
    )
  })

  it('un organizer voit la fiche comme le public, sans formulaire', async () => {
    login('organizer')
    await open()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.text()).toContain('Seul un propriétaire peut la modifier.')
    expect(wrapper.get('[data-testid="organization-card"]').text()).toContain('Club Roc')
    expect(wrapper.text()).toContain('8 Boulevard du Port 80000 Amiens')
  })

  it('un organizer voit les photos dans l’encart ; un owner les gère dans leur section (ADR-090)', async () => {
    photoList = [{ id: '0192f2a0-7b1c-7cc0-8f00-000000000001', altText: 'Le mur de bloc' }]
    login('organizer')
    await open()
    expect(wrapper.find('[data-testid="photos-manager"]').exists()).toBe(false)
    // L'image se lit avec le jeton, puis devient une adresse `blob:`.
    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="organization-photo"] img').exists()).toBe(true),
    )
    const image = wrapper.get(
      '[data-testid="organization-card"] [data-testid="organization-photo"] img',
    )
    expect(image.attributes()).toMatchObject({ src: 'blob:photo', alt: 'Le mur de bloc' })
    wrapper.unmount()

    login('owner')
    await open()
    expect(wrapper.get('[data-testid="photos-manager"]').text()).toContain('Photo 1 sur 1')
    expect(wrapper.find('[data-testid="organization-card"]').exists()).toBe(false)
  })
})
