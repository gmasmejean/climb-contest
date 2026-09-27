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

const meta = {
  competition: {
    id: 'comp-1',
    slug: 'abc123',
    name: 'Coupe du club',
    venue: 'Salle Roc',
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
    address: {
      label: '8 Boulevard du Port 80000 Amiens',
      postcode: '80000',
      city: 'Amiens',
      latitude: 49.897442,
      longitude: 2.290084,
    },
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
