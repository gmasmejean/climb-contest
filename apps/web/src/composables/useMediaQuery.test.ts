import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useMediaQuery } from './useMediaQuery'

// jsdom n'a pas `MediaQueryListEvent` ; le composable ne lit que `matches`.
type Listener = (event: Pick<MediaQueryListEvent, 'matches'>) => void

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>()
  const list = {
    matches: initial,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => list),
  )
  return {
    listeners,
    change(matches: boolean) {
      for (const listener of listeners) listener({ matches })
    },
  }
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reprend l’état initial de la requête', () => {
    stubMatchMedia(true)
    const scope = effectScope()
    const matches = scope.run(() => useMediaQuery('(min-width: 1024px)'))
    expect(matches?.value).toBe(true)
    scope.stop()
  })

  it('suit les changements, puis se désabonne avec son scope', () => {
    const media = stubMatchMedia(false)
    const scope = effectScope()
    const matches = scope.run(() => useMediaQuery('(min-width: 1024px)'))

    media.change(true)
    expect(matches?.value).toBe(true)

    scope.stop()
    expect(media.listeners.size).toBe(0)
  })

  it('vaut faux quand matchMedia n’existe pas', () => {
    vi.stubGlobal('matchMedia', undefined)
    const scope = effectScope()
    const matches = scope.run(() => useMediaQuery('(min-width: 1024px)'))
    expect(matches?.value).toBe(false)
    scope.stop()
  })
})
