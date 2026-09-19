import { describe, expect, it } from 'vitest'

import { ApiError } from '../api/client'
import { UNREACHABLE_MESSAGE, describeError, isServerUnreachable } from './network-errors'

describe('erreurs réseau', () => {
  it('une coupure réseau (fetch rejette en TypeError) est « injoignable » et dit quoi faire', () => {
    const error = new TypeError('Failed to fetch')
    expect(isServerUnreachable(error)).toBe(true)
    expect(describeError(error)).toBe(UNREACHABLE_MESSAGE)
    expect(UNREACHABLE_MESSAGE).toContain('Vérifiez votre connexion')
    expect(UNREACHABLE_MESSAGE).toContain('perdu')
  })

  it('une réponse du serveur n’est PAS « injoignable » : on affiche ce qu’il a dit', () => {
    const error = new ApiError(409, 'Conflit', 'Ce tour est déjà ouvert.')
    expect(isServerUnreachable(error)).toBe(false)
    expect(describeError(error)).toBe('Ce tour est déjà ouvert.')
  })

  it('sans détail, le titre du serveur fait foi', () => {
    expect(describeError(new ApiError(500, 'Erreur interne'))).toBe('Erreur interne')
  })

  it('accepte un message de repli propre à l’écran', () => {
    expect(describeError(new Error('boum'), 'Chargement impossible.')).toBe('Chargement impossible.')
  })
})
