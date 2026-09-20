import { beforeEach, describe, expect, it, vi } from 'vitest'

// `virtual:pwa-register` n'existe qu'à la construction (vite-plugin-pwa).
const registerSW = vi.hoisted(() => vi.fn())
vi.mock('virtual:pwa-register', () => ({ registerSW }))

import { setUpPwaUpdate } from './pwa-update'

describe('setUpPwaUpdate (ADR-061)', () => {
  const updateSW = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    registerSW.mockReset()
    registerSW.mockReturnValue(updateSW)
    updateSW.mockClear()
  })

  it('enregistre le service worker sans attendre le prochain chargement', () => {
    setUpPwaUpdate()

    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }))
  })

  it('active la nouvelle version dès qu’elle est prête, en rechargeant la page', () => {
    setUpPwaUpdate()
    const options = registerSW.mock.calls[0]?.[0] as { onNeedRefresh: () => void }

    options.onNeedRefresh()

    expect(updateSW).toHaveBeenCalledExactlyOnceWith(true)
  })
})
