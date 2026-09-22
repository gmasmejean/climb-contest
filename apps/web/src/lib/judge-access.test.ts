import { describe, expect, it } from 'vitest'

import { judgeAccessUrl, type RevealedToken } from './judge-access'

const ORIGIN = 'https://compet.exemple.test'
const tokens: RevealedToken[] = [
  { competitionId: 'comp-1', judgeId: 'judge-session', accessToken: 'jeton-en-memoire' },
  { competitionId: 'comp-2', judgeId: 'judge-ailleurs', accessToken: 'jeton-autre-compet' },
]

describe('judgeAccessUrl', () => {
  it('préfère le lien que le serveur conserve en clair', () => {
    const url = judgeAccessUrl(
      { id: 'judge-1', revokedAt: null, accessUrl: `${ORIGIN}/j/stocke` },
      tokens,
      'comp-1',
      ORIGIN,
    )
    expect(url).toBe(`${ORIGIN}/j/stocke`)
  })

  it('reconstruit le lien d’un jeton révélé cette session', () => {
    const url = judgeAccessUrl({ id: 'judge-session', revokedAt: null }, tokens, 'comp-1', ORIGIN)
    expect(url).toBe(`${ORIGIN}/j/jeton-en-memoire`)
  })

  it('ne rend rien quand il n’y a ni clair stocké ni jeton en mémoire', () => {
    expect(
      judgeAccessUrl({ id: 'judge-muet', revokedAt: null }, tokens, 'comp-1', ORIGIN),
    ).toBeNull()
  })

  it('ne confond pas les compétitions', () => {
    expect(
      judgeAccessUrl({ id: 'judge-ailleurs', revokedAt: null }, tokens, 'comp-1', ORIGIN),
    ).toBeNull()
  })

  it('ne rend rien pour un juge révoqué, même avec son jeton en mémoire', () => {
    expect(
      judgeAccessUrl(
        { id: 'judge-session', revokedAt: new Date('2026-09-21T08:00:00Z') },
        tokens,
        'comp-1',
        ORIGIN,
      ),
    ).toBeNull()
  })

  it('ne rend rien pour un juge révoqué dont le serveur renverrait encore un lien', () => {
    expect(
      judgeAccessUrl(
        { id: 'judge-1', revokedAt: '2026-09-21T08:00:00Z', accessUrl: `${ORIGIN}/j/stocke` },
        tokens,
        'comp-1',
        ORIGIN,
      ),
    ).toBeNull()
  })
})
