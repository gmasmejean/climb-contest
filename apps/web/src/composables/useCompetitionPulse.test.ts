import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useCompetitionPulse, type CompetitionPulse } from './useCompetitionPulse'

interface DashboardStub {
  alerts: unknown[]
  categories: { categoryId: string; label: string; routes: { done: number; expected: number }[] }[]
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function stubApi(options: {
  dashboard: DashboardStub
  checks?: { id: string; ok: boolean; items: unknown[] }[]
  /** Nombre d'appels au tableau de bord qui réussissent avant de tomber en panne. */
  dashboardSuccesses?: number
}): void {
  let dashboardCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.endsWith('/dashboard')) {
        dashboardCalls += 1
        if (
          options.dashboardSuccesses !== undefined &&
          dashboardCalls > options.dashboardSuccesses
        ) {
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        return Promise.resolve(
          jsonResponse({
            computedAt: '2026-09-22T10:00:00.000Z',
            competitorsPending: [],
            judges: [],
            ...options.dashboard,
          }),
        )
      }
      if (url.endsWith('/readiness')) {
        const checks = options.checks ?? []
        return Promise.resolve(jsonResponse({ ready: checks.every((c) => c.ok), checks }))
      }
      return Promise.reject(new Error(`URL non gérée par ce test : ${url}`))
    }),
  )
}

/** Monte le composable dans un hôte minimal et rend son pouls accessible. */
async function open(live = true): Promise<{ pulse: CompetitionPulse; unmount: () => void }> {
  let captured: CompetitionPulse | null = null
  const Host = defineComponent({
    setup() {
      captured = useCompetitionPulse('c1', { live })
      return () => h('div')
    },
  })
  const wrapper = mount(Host, {
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
  await flushPromises()
  if (captured === null) throw new Error('Le composable n’a pas été monté.')
  return { pulse: captured, unmount: () => wrapper.unmount() }
}

const ROUTES = (done: number, expected: number) => [{ done, expected }]

describe('useCompetitionPulse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('additionne l’avancement de toutes les voies de toutes les catégories', async () => {
    stubApi({
      dashboard: {
        alerts: [],
        categories: [
          { categoryId: 'a', label: 'U16', routes: ROUTES(12, 30) },
          { categoryId: 'b', label: 'U18', routes: ROUTES(8, 20) },
        ],
      },
    })
    const { pulse, unmount } = await open()
    expect(pulse.done.value).toBe(20)
    expect(pulse.expected.value).toBe(50)
    unmount()
  })

  it('compte les conflits séparément des autres alertes', async () => {
    stubApi({
      dashboard: {
        alerts: [
          { type: 'unresolved_conflict', conflictGroup: 'g1', routeId: 'r', competitorId: 'c' },
          { type: 'unresolved_conflict', conflictGroup: 'g2', routeId: 'r', competitorId: 'c' },
          { type: 'judge_silent', judgeId: 'j', judgeDisplayName: 'Ana', minutesSinceLastSeen: 12 },
        ],
        categories: [],
      },
    })
    const { pulse, unmount } = await open()
    expect(pulse.conflictCount.value).toBe(2)
    expect(pulse.alertCount.value).toBe(3)
    unmount()
  })

  it('fait passer un conflit devant une alerte dans la pastille', async () => {
    stubApi({
      dashboard: {
        alerts: [
          { type: 'unresolved_conflict', conflictGroup: 'g1', routeId: 'r', competitorId: 'c' },
          { type: 'judge_silent', judgeId: 'j', judgeDisplayName: 'Ana', minutesSinceLastSeen: 12 },
        ],
        categories: [],
      },
    })
    const { pulse, unmount } = await open()
    // Un conflit retient une publication ; une alerte n'est qu'un signal.
    expect(pulse.pilotageBadge.value).toEqual({ count: 1, label: '1 conflit', tone: 'danger' })
    unmount()
  })

  it('retombe sur les alertes quand aucun conflit n’attend', async () => {
    stubApi({
      dashboard: {
        alerts: [
          { type: 'judge_silent', judgeId: 'j', judgeDisplayName: 'Ana', minutesSinceLastSeen: 12 },
          {
            type: 'route_stalled',
            routeId: 'r',
            routeNumber: 3,
            roundId: 'x',
            minutesSinceLastAscent: 20,
          },
        ],
        categories: [],
      },
    })
    const { pulse, unmount } = await open()
    expect(pulse.pilotageBadge.value).toEqual({ count: 2, label: '2 alertes', tone: 'warning' })
    unmount()
  })

  it('n’affiche aucune pastille quand tout va bien', async () => {
    stubApi({
      dashboard: { alerts: [], categories: [] },
      checks: [{ id: 'a', ok: true, items: [] }],
    })
    const { pulse, unmount } = await open()
    expect(pulse.pilotageBadge.value).toBeUndefined()
    expect(pulse.readinessBadge.value).toBeUndefined()
    unmount()
  })

  it('compte les points bloquants de « Prêt à démarrer ? »', async () => {
    stubApi({
      dashboard: { alerts: [], categories: [] },
      checks: [
        { id: 'category_without_route', ok: false, items: [{}] },
        { id: 'route_without_judge', ok: false, items: [{}] },
        { id: 'competitor_without_bib', ok: true, items: [] },
      ],
    })
    const { pulse, unmount } = await open()
    expect(pulse.blockingCount.value).toBe(2)
    expect(pulse.readinessBadge.value).toEqual({
      count: 2,
      label: '2 points à corriger',
      tone: 'warning',
    })
    unmount()
  })

  it('signale des chiffres périmés dès qu’une relance échoue', async () => {
    stubApi({
      dashboard: {
        alerts: [],
        categories: [{ categoryId: 'a', label: 'U16', routes: ROUTES(5, 10) }],
      },
      dashboardSuccesses: 1,
    })
    const { pulse, unmount } = await open()
    expect(pulse.isStale.value).toBe(false)
    expect(pulse.lastUpdate.value).not.toBeNull()

    // `retry: 1` : la relance échoue, patiente, réessaie, échoue encore.
    vi.useFakeTimers()
    const settled = pulse.refetch()
    await vi.advanceTimersByTimeAsync(5000)
    await settled
    vi.useRealTimers()
    await flushPromises()

    // Les chiffres restent affichés — mais l'écran doit dire qu'ils datent.
    expect(pulse.isStale.value).toBe(true)
    expect(pulse.done.value).toBe(5)
    unmount()
  })
})
