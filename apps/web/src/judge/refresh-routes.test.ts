import { describe, expect, it, vi } from 'vitest'

import {
  MIN_AUTO_REFRESH_INTERVAL_MS,
  createRefreshScheduler,
  refreshRoutesIfQueueIdle,
  type RefreshOutcome,
} from './refresh-routes'

describe('refreshRoutesIfQueueIdle', () => {
  it('ne fait rien sans session juge', async () => {
    const bootstrap = vi.fn()
    const outcome = await refreshRoutesIfQueueIdle({ hasJudgeSession: () => false, bootstrap })
    expect(outcome).toBe('no-session')
    expect(bootstrap).not.toHaveBeenCalled()
  })

  it('demande une actualisation conditionnelle à la file vide', async () => {
    const bootstrap = vi.fn().mockResolvedValue('written')
    const outcome = await refreshRoutesIfQueueIdle({ hasJudgeSession: () => true, bootstrap })
    expect(outcome).toBe('refreshed')
    expect(bootstrap).toHaveBeenCalledWith({ onlyIfQueueIdle: true })
  })

  it('signale une file non vide sans lever', async () => {
    const bootstrap = vi.fn().mockResolvedValue('skipped')
    expect(await refreshRoutesIfQueueIdle({ hasJudgeSession: () => true, bootstrap })).toBe(
      'waiting-for-queue',
    )
  })

  it('avale une erreur réseau : un échec en salle n’est pas une erreur à montrer', async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error('Réseau coupé'))
    expect(await refreshRoutesIfQueueIdle({ hasJudgeSession: () => true, bootstrap })).toBe(
      'failed',
    )
  })
})

describe('createRefreshScheduler', () => {
  function setUp(outcomes: RefreshOutcome[]) {
    let now = 1_000_000
    const refresh = vi.fn<() => Promise<RefreshOutcome>>()
    for (const outcome of outcomes) refresh.mockResolvedValueOnce(outcome)
    const scheduler = createRefreshScheduler({ now: () => now, refresh })
    return { scheduler, refresh, advance: (ms: number) => (now += ms) }
  }

  it('actualise au premier déclencheur', async () => {
    const { scheduler, refresh } = setUp(['refreshed'])
    await scheduler.request()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('respecte l’intervalle minimal entre deux actualisations automatiques', async () => {
    const { scheduler, refresh, advance } = setUp(['refreshed', 'refreshed'])
    await scheduler.request()
    advance(MIN_AUTO_REFRESH_INTERVAL_MS - 1)
    await scheduler.request()
    expect(refresh).toHaveBeenCalledTimes(1)

    advance(2)
    await scheduler.request()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('reporte quand la file n’est pas vide, puis réessaie dès qu’elle se vide, sans attendre l’intervalle', async () => {
    const { scheduler, refresh } = setUp(['waiting-for-queue', 'refreshed'])
    await scheduler.request()
    expect(refresh).toHaveBeenCalledTimes(1)

    // La file se vide 2 secondes plus tard : bien avant les 30 s.
    await scheduler.onQueueIdle()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('ne réessaie pas à chaque file vide quand rien n’était en attente', async () => {
    const { scheduler, refresh } = setUp(['refreshed'])
    await scheduler.request()
    await scheduler.onQueueIdle()
    await scheduler.onQueueIdle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('n’enchaîne pas deux actualisations en parallèle', async () => {
    let release: (outcome: RefreshOutcome) => void = () => {}
    const refresh = vi.fn(
      () =>
        new Promise<RefreshOutcome>((resolve) => {
          release = resolve
        }),
    )
    const scheduler = createRefreshScheduler({ now: () => 1_000_000, refresh })

    const first = scheduler.request()
    await scheduler.request()
    release('refreshed')
    await first

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('après un échec réseau, attend le prochain déclencheur (pas de boucle)', async () => {
    const { scheduler, refresh } = setUp(['failed'])
    await scheduler.request()
    await scheduler.onQueueIdle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
