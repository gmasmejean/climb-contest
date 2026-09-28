import { VueQueryPlugin } from '@tanstack/vue-query'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import PublicRoomScreen from './PublicRoomScreen.vue'

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
    address: null,
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

function rankingFor(categoryId: string) {
  return {
    categoryId,
    started: false,
    provisional: false,
    generatedAt: '2026-05-01T00:00:00.000Z',
    entries: [],
  }
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

describe('PublicRoomScreen', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.stubGlobal('EventSource', FakeEventSource)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/v1/public/abc123')) return Promise.resolve(jsonResponse(meta))
        if (url.includes('/rankings?category=')) {
          const categoryId = new URL(url, 'http://localhost').searchParams.get('category') ?? ''
          return Promise.resolve(jsonResponse(rankingFor(categoryId)))
        }
        return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
      }),
    )

    router = createRouter({
      history: createWebHistory(),
      routes: [{ path: '/c/:slug/salle', name: 'public-room-screen', component: PublicRoomScreen }],
    })
    await router.push('/c/abc123/salle')
    await router.isReady()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('affiche la première catégorie puis défile vers la suivante après le délai', async () => {
    const wrapper = mount(PublicRoomScreen, { global: { plugins: [router, VueQueryPlugin] } })
    await flush()

    expect(wrapper.text()).toContain('U16 Femme')

    await vi.advanceTimersByTimeAsync(10_000)
    await flush()

    expect(wrapper.text()).toContain('Sénior Homme')
  })
})
