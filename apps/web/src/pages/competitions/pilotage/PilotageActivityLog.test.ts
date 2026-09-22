import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { stubViewport } from '../../../test-utils/media-query'
import PilotageActivityLog from './PilotageActivityLog.vue'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const entries = [
  {
    id: '0192f0c0-0000-7000-8000-000000000001',
    type: 'ascent_corrected',
    actorType: 'organizer',
    actorId: null,
    actorLabel: 'Alex',
    payload: { holdNumber: 25 },
    reason: 'Erreur de prise',
    createdAt: '2026-09-22T10:05:00.000Z',
  },
  {
    id: '0192f0c0-0000-7000-8000-000000000002',
    type: 'round_status_changed',
    actorType: 'system',
    actorId: null,
    actorLabel: null,
    payload: {},
    reason: null,
    createdAt: '2026-09-22T09:00:00.000Z',
  },
]

/** Renvoie les URL appelées, pour lire les filtres réellement envoyés. */
function stubApi(): string[] {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)
      return Promise.resolve(jsonResponse({ entries }))
    }),
  )
  return calls
}

function open() {
  return mount(PilotageActivityLog, {
    props: { competitionId: 'c1' },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
}

describe('PilotageActivityLog — tableau filtrable (Lot 20)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rend un tableau à partir de 1024 px et des cartes en dessous', async () => {
    stubApi()
    stubViewport(1024)
    const table = open()
    await flushPromises()
    expect(table.find('table').exists()).toBe(true)
    expect(table.findAll('[data-testid="data-list-row"]')).toHaveLength(2)

    vi.unstubAllGlobals()
    stubApi()
    stubViewport(1023)
    const cards = open()
    await flushPromises()
    expect(cards.find('table').exists()).toBe(false)
    expect(cards.findAll('[data-testid="data-list-row"]')).toHaveLength(2)
  })

  it('ne sort la colonne Détail qu’au-delà de 1280 px', async () => {
    stubApi()
    stubViewport(1024)
    const narrow = open()
    await flushPromises()
    expect(narrow.findAll('thead th').map((th) => th.text())).not.toContain('Détail')

    vi.unstubAllGlobals()
    stubApi()
    stubViewport(1280)
    const wide = open()
    await flushPromises()
    const headers = wide.findAll('thead th').map((th) => th.text())
    expect(headers.some((header) => header.includes('Détail'))).toBe(true)
  })

  it('envoie les bornes de dates au serveur, en heure locale', async () => {
    const calls = stubApi()
    stubViewport(1024)
    const wrapper = open()
    await flushPromises()

    const dateInputs = wrapper.findAll('input[type="date"]')
    expect(dateInputs).toHaveLength(2)
    await dateInputs[0]?.setValue('2026-09-22')
    await flushPromises()

    const last = calls.at(-1) ?? ''
    expect(last).toContain('from=')
    // La borne est minuit LOCAL, pas minuit UTC : sinon les premières heures
    // d'une journée de compétition en France disparaissent du journal.
    expect(decodeURIComponent(last)).toContain(new Date('2026-09-22T00:00:00').toISOString())
  })

  it('trie sur une colonne sans jamais perdre l’ordre par défaut', async () => {
    stubApi()
    stubViewport(1024)
    const wrapper = open()
    await flushPromises()

    // Par défaut : du plus récent au plus ancien, comme le renvoie le serveur.
    const before = wrapper.findAll('[data-testid="data-list-row"]').map((row) => row.text())
    expect(before[0]).toContain('Passage corrigé')

    const header = wrapper
      .findAll('thead th button')
      .find((button) => button.text().includes('Heure'))
    await header?.trigger('click')
    await flushPromises()
    const after = wrapper.findAll('[data-testid="data-list-row"]').map((row) => row.text())
    expect(after[0]).toContain('Statut du tour')
  })

  it('affiche le motif d’une correction', async () => {
    stubApi()
    stubViewport(1024)
    const wrapper = open()
    await flushPromises()
    expect(wrapper.text()).toContain('Erreur de prise')
  })
})
