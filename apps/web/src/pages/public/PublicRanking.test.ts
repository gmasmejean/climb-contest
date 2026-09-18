import { VueQueryPlugin } from '@tanstack/vue-query'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicRanking from './PublicRanking.vue'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('PublicRanking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("affiche un message si le classement n'a pas encore démarré", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ categoryId: 'cat-1', started: false, provisional: false, generatedAt: '2026-05-01T00:00:00.000Z', entries: [] }),
    )
    const wrapper = mount(PublicRanking, {
      props: { slug: 'abc', categoryId: 'cat-1', format: 'contest' },
      global: { plugins: [VueQueryPlugin] },
    })
    await flush()

    expect(wrapper.text()).toContain("n'est pas encore disponible")
  })

  it('affiche le badge « provisoire » et le détail par voie dépliable', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        categoryId: 'cat-1',
        started: true,
        provisional: true,
        generatedAt: '2026-05-01T00:00:00.000Z',
        entries: [
          {
            rank: 1,
            bib: 47,
            firstName: 'Léa',
            lastName: 'Martin',
            club: 'Club Demo',
            reachedRoundId: 'round-1',
            rounds: [
              {
                roundId: 'round-1',
                roundType: 'qualification',
                combinedRank: 1,
                routes: [
                  {
                    routeId: 'route-1',
                    routeNumber: 3,
                    routeName: null,
                    holdNumber: 25,
                    modifier: 'plus',
                    isTop: false,
                    status: 'valid',
                    routeRank: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    const wrapper = mount(PublicRanking, {
      props: { slug: 'abc', categoryId: 'cat-1', format: 'phases' },
      global: { plugins: [VueQueryPlugin] },
    })
    await flush()

    expect(wrapper.text()).toContain('provisoire')
    expect(wrapper.text()).toContain('Léa Martin')
    expect(wrapper.text()).toContain('Dossard 47')
    expect(wrapper.text()).toContain('Club Demo')
    expect(wrapper.text()).toContain('Qualification')
    expect(wrapper.text()).toContain('Voie 3')
    expect(wrapper.text()).toContain('prise 25+')
  })
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
