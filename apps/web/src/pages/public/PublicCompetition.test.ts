import { VueQueryPlugin } from '@tanstack/vue-query'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import PublicCompetition from './PublicCompetition.vue'

vi.mock('../../lib/leaflet-map', () => ({
  createLocationMap: vi.fn(() => ({ destroy: vi.fn() })),
}))

class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const orgAddress = {
  label: '8 Boulevard du Port 80000 Amiens',
  postcode: '80000',
  city: 'Amiens',
  latitude: 49.897442,
  longitude: 2.290084,
}

let meta = {
  competition: {
    id: 'comp-1',
    slug: 'abc123',
    name: 'Coupe du club',
    venue: 'Salle Roc',
    address: null as null | typeof orgAddress,
    startsOn: '2026-05-01',
    endsOn: '2026-05-01',
    format: 'contest',
    status: 'running',
  },
  organization: {
    name: 'Club Roc',
    type: 'club',
    description: 'Club d’escalade associatif.',
    contactEmail: 'contact@club-roc.test',
    contactPhone: null,
    websiteUrl: 'https://club-roc.test',
    address: orgAddress,
    photos: [] as { id: string; altText: string | null }[],
  },
  categories: [
    { id: 'cat-1', label: 'U16 Femme', displayOrder: 0 },
    { id: 'cat-2', label: 'Sénior Homme', displayOrder: 1 },
  ],
  rounds: [],
}

const emptyRanking = (categoryId: string) => ({
  categoryId,
  started: false,
  provisional: false,
  generatedAt: '2026-05-01T00:00:00.000Z',
  entries: [],
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PublicCompetition', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(async () => {
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/v1/public/abc123')) return Promise.resolve(jsonResponse(meta))
        if (url.includes('/rankings?category=')) {
          const categoryId = new URL(url, 'http://localhost').searchParams.get('category') ?? ''
          return Promise.resolve(jsonResponse(emptyRanking(categoryId)))
        }
        if (url.includes('/routes?category=')) return Promise.resolve(jsonResponse([]))
        return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
      }),
    )
    localStorage.clear()

    router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/c/:slug', name: 'public-competition', component: PublicCompetition }],
    })
    await router.push('/c/abc123')
    await router.isReady()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('affiche le nom de la compétition et sélectionne la première catégorie par défaut', async () => {
    const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    expect(wrapper.text()).toContain('Coupe du club')
    expect(wrapper.text()).toContain('Salle Roc')
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('cat-1')
  })

  it('montre l’organisation sous le classement, avec son adresse et son contact (ADR-088)', async () => {
    const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    const card = wrapper.get('[data-testid="organization-card"]')
    expect(card.text()).toContain('Organisé par')
    expect(card.get('h2').text()).toBe('Club Roc')
    expect(card.text()).toContain('8 Boulevard du Port 80000 Amiens')
    expect(card.text()).toContain('contact@club-roc.test')
    // Après les onglets et leur contenu : le classement reste en tête de page.
    const html = wrapper.html()
    expect(html.indexOf('data-testid="organization-card"')).toBeGreaterThan(html.indexOf('role="tablist"'))
  })

  it('montre les photos de l’organisation, lues par la compétition affichée (ADR-090)', async () => {
    const baseMeta = meta
    meta = {
      ...baseMeta,
      organization: {
        ...baseMeta.organization,
        photos: [
          { id: 'p2', altText: 'Le mur de bloc' },
          { id: 'p1', altText: null },
        ],
      },
    }
    try {
      const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
      await flush()
      const images = wrapper
        .get('[data-testid="organization-card"]')
        .findAll('[data-testid="organization-photo"] img')
      expect(images.map((image) => [image.attributes('src'), image.attributes('alt')])).toEqual([
        ['/api/v1/public/abc123/organization/photos/p2', 'Le mur de bloc'],
        ['/api/v1/public/abc123/organization/photos/p1', 'Photo 2 sur 2 de Club Roc'],
      ])
    } finally {
      meta = baseMeta
    }
  })

  describe('lieu de la compétition (ADR-089)', () => {
    const baseMeta = meta
    afterEach(() => {
      meta = baseMeta
    })

    it('sans adresse : ni section « Lieu », et l’encart garde sa carte', async () => {
      const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
      await flush()
      expect(wrapper.find('[data-testid="competition-place"]').exists()).toBe(false)
      expect(
        wrapper.get('[data-testid="organization-card"]').find('[data-testid="location-map"]').exists(),
      ).toBe(true)
    })

    it('chez l’organisation : l’adresse en tête, une section « Lieu », pas de carte en double', async () => {
      meta = { ...baseMeta, competition: { ...baseMeta.competition, address: orgAddress } }
      const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
      await flush()
      expect(wrapper.get('main header').text()).toContain('8 Boulevard du Port 80000 Amiens')
      const place = wrapper.get('[data-testid="competition-place"]')
      expect(place.text()).toContain('Salle Roc')
      expect(place.find('[data-testid="location-map"]').exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="location-map"]')).toHaveLength(1)
    })

    it('ailleurs : la carte du lieu et celle de l’organisation', async () => {
      meta = {
        ...baseMeta,
        competition: {
          ...baseMeta.competition,
          address: { ...orgAddress, label: 'Gymnase, Abbeville', latitude: 50.1, longitude: 1.83 },
        },
      }
      const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
      await flush()
      expect(wrapper.findAll('[data-testid="location-map"]')).toHaveLength(2)
    })
  })

  it('mémorise la catégorie choisie dans le stockage local, par compétition', async () => {
    const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    await wrapper.find('select').setValue('cat-2')
    await flush()

    expect(localStorage.getItem('climbcontest:public-category:abc123')).toBe('cat-2')
  })

  it('affiche l’état des tours pour la catégorie choisie, pas pour les autres (ADR-065)', async () => {
    const withRounds = {
      ...meta,
      competition: { ...meta.competition, format: 'phases' },
      rounds: [
        {
          id: 'round-1',
          type: 'qualification',
          displayOrder: 0,
          categories: [
            { categoryId: 'cat-1', status: 'closed' },
            { categoryId: 'cat-2', status: 'open' },
          ],
        },
        {
          id: 'round-2',
          type: 'final',
          displayOrder: 1,
          categories: [{ categoryId: 'cat-2', status: 'draft' }],
        },
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/v1/public/abc123')) return Promise.resolve(jsonResponse(withRounds))
        if (url.includes('/rankings?category=')) {
          const categoryId = new URL(url, 'http://localhost').searchParams.get('category') ?? ''
          return Promise.resolve(jsonResponse(emptyRanking(categoryId)))
        }
        if (url.includes('/routes?category=')) return Promise.resolve(jsonResponse([]))
        return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
      }),
    )
    const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    // cat-1 (U16 Femme) : qualification clôturée ; la finale ne la concerne pas.
    expect(wrapper.text()).toContain('Qualification : clôturé')
    expect(wrapper.text()).not.toContain('Finale')

    await wrapper.find('select').setValue('cat-2')
    await flush()

    // cat-2 (Sénior Homme) : qualification en cours, finale à venir.
    expect(wrapper.text()).toContain('Qualification : en cours')
    expect(wrapper.text()).toContain('Finale : à venir')
  })

  it('bascule vers l’onglet Voies', async () => {
    const wrapper = mount(PublicCompetition, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    const routesTabButton = wrapper.findAll('[role="tab"]').find((btn) => btn.text() === 'Voies')
    expect(routesTabButton).toBeTruthy()
    await routesTabButton?.trigger('click')
    await flush()

    expect(wrapper.find('[aria-label="Voies"]').exists()).toBe(true)
  })
})
