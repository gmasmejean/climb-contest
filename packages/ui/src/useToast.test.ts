import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useToast } from './useToast'

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const { toasts, dismiss } = useToast()
    // État module-scope partagé (comme useAscentRowState) — nettoyé entre les tests.
    for (const toast of [...toasts]) dismiss(toast.id)
  })

  it('plafonne la pile à 3 notifications visibles (Lot 6 : saisies rapprochées sans attente réseau)', () => {
    const { toasts, show } = useToast()
    show('un')
    show('deux')
    show('trois')
    show('quatre')
    expect(toasts).toHaveLength(3)
    expect(toasts.map((t) => t.text)).toEqual(['deux', 'trois', 'quatre'])
  })

  it('retire une notification après sa durée d’affichage', () => {
    const { toasts, show } = useToast()
    show('un', 'info', 1000)
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(1001)
    expect(toasts).toHaveLength(0)
  })
})
