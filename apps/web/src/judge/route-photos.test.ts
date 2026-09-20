import type { JudgeRouteDetail } from '@climbcontest/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { judgeDb } from './local-db'
import { syncRoutePhotos } from './route-photos'

const ROUTE_A = '00000000-0000-4000-8000-0000000000a1'
const ROUTE_B = '00000000-0000-4000-8000-0000000000b1'
const ASSET_1 = '00000000-0000-4000-8000-0000000000c1'
const ASSET_2 = '00000000-0000-4000-8000-0000000000c2'

function detail(routeId: string, assetId: string | null): JudgeRouteDetail {
  return {
    route: {
      id: routeId,
      number: 1,
      name: null,
      holdCount: 40,
      categories: [],
      photo: assetId ? { assetId, holds: [{ number: 1, x: 0.5, y: 0.5 }] } : null,
    },
    round: null,
    timingEnabled: false,
    competitors: [],
  }
}

const file = (byte: number) => ({
  bytes: new Uint8Array([0xff, 0xd8, 0xff, byte]).buffer,
  mimeType: 'image/jpeg',
})

beforeEach(async () => {
  await judgeDb.routePhotos.clear()
})

describe('syncRoutePhotos', () => {
  it('télécharge et range la photo d’une voie qui en a une', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(file(1))
    expect(await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], { fetchPhoto })).toBe(1)

    expect(fetchPhoto).toHaveBeenCalledWith(ROUTE_A)
    const stored = await judgeDb.routePhotos.get(ROUTE_A)
    expect(stored).toMatchObject({ routeId: ROUTE_A, assetId: ASSET_1, mimeType: 'image/jpeg' })
    expect([...new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))]).toEqual([0xff, 0xd8, 0xff, 1])
  })

  it('ne retélécharge pas une photo déjà à jour', async () => {
    const fetchPhoto = vi.fn().mockResolvedValue(file(1))
    await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], { fetchPhoto })
    fetchPhoto.mockClear()

    expect(await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], { fetchPhoto })).toBe(0)
    expect(fetchPhoto).not.toHaveBeenCalled()
  })

  it('remplace la photo quand l’identifiant de l’image a changé', async () => {
    await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], {
      fetchPhoto: () => Promise.resolve(file(1)),
    })
    await syncRoutePhotos([detail(ROUTE_A, ASSET_2)], {
      fetchPhoto: () => Promise.resolve(file(2)),
    })

    const stored = await judgeDb.routePhotos.get(ROUTE_A)
    expect(stored?.assetId).toBe(ASSET_2)
    expect(new Uint8Array(stored?.bytes ?? new ArrayBuffer(0))[3]).toBe(2)
  })

  it('supprime la photo d’une voie qui n’en a plus, et celle d’une voie qui a disparu', async () => {
    await syncRoutePhotos([detail(ROUTE_A, ASSET_1), detail(ROUTE_B, ASSET_2)], {
      fetchPhoto: () => Promise.resolve(file(1)),
    })
    expect(await judgeDb.routePhotos.count()).toBe(2)

    // A n'a plus de photo ; B n'est plus dans l'amorçage.
    await syncRoutePhotos([detail(ROUTE_A, null)], {
      fetchPhoto: () => Promise.reject(new Error('inutile')),
    })
    expect(await judgeDb.routePhotos.count()).toBe(0)
  })

  it('ne lève jamais quand le téléchargement échoue, et réessaie la fois suivante', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('réseau coupé'))
    await expect(
      syncRoutePhotos([detail(ROUTE_A, ASSET_1)], { fetchPhoto: failing }),
    ).resolves.toBe(0)
    expect(await judgeDb.routePhotos.count()).toBe(0)

    const working = vi.fn().mockResolvedValue(file(1))
    expect(await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], { fetchPhoto: working })).toBe(1)
  })

  it('un échec sur une voie n’empêche pas les autres', async () => {
    const fetchPhoto = vi.fn((routeId: string) =>
      routeId === ROUTE_A ? Promise.reject(new Error('KO')) : Promise.resolve(file(9)),
    )
    await syncRoutePhotos([detail(ROUTE_A, ASSET_1), detail(ROUTE_B, ASSET_2)], { fetchPhoto })

    expect(await judgeDb.routePhotos.get(ROUTE_A)).toBeUndefined()
    expect((await judgeDb.routePhotos.get(ROUTE_B))?.assetId).toBe(ASSET_2)
  })

  it('une photo remplacée qu’on n’arrive pas à retélécharger ne reste pas affichée', async () => {
    await syncRoutePhotos([detail(ROUTE_A, ASSET_1)], {
      fetchPhoto: () => Promise.resolve(file(1)),
    })
    await syncRoutePhotos([detail(ROUTE_A, ASSET_2)], {
      fetchPhoto: () => Promise.reject(new Error('réseau coupé')),
    })
    // L'ancienne image ne correspond plus aux numéros de prises annoncés.
    expect(await judgeDb.routePhotos.get(ROUTE_A)).toBeUndefined()
  })
})
