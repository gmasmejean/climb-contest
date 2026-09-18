import { VueQueryPlugin } from '@tanstack/vue-query'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PublicRoutes from './PublicRoutes.vue'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PublicRoutes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('intègre un lecteur pour une vidéo YouTube reconnue', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        {
          id: 'route-1',
          number: 1,
          name: 'Le toit',
          holdCount: 40,
          sector: 'Mur nord',
          color: 'rouge',
          videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        },
      ]),
    )
    const wrapper = mount(PublicRoutes, {
      props: { slug: 'abc', categoryId: 'cat-1' },
      global: { plugins: [VueQueryPlugin] },
    })
    await flush()

    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)
    expect(iframe.attributes('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('affiche un simple lien pour une vidéo hors liste (jamais une iframe non validée)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        {
          id: 'route-1',
          number: 1,
          name: null,
          holdCount: 40,
          sector: null,
          color: null,
          videoUrl: 'https://example.com/video/123',
        },
      ]),
    )
    const wrapper = mount(PublicRoutes, {
      props: { slug: 'abc', categoryId: 'cat-1' },
      global: { plugins: [VueQueryPlugin] },
    })
    await flush()

    expect(wrapper.find('iframe').exists()).toBe(false)
    const link = wrapper.find('a')
    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('https://example.com/video/123')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('ne montre ni lecteur ni lien quand aucune vidéo n’est renseignée', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        { id: 'route-1', number: 1, name: null, holdCount: 40, sector: null, color: null, videoUrl: null },
      ]),
    )
    const wrapper = mount(PublicRoutes, {
      props: { slug: 'abc', categoryId: 'cat-1' },
      global: { plugins: [VueQueryPlugin] },
    })
    await flush()

    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('40 prises')
  })
})
