import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'

import { createAccessTokenSigner, createJudgeTokenSigner } from './jwt'

const ORGANIZER_SECRET = 'organizer-secret-organizer-secret-32'
const JUDGE_SECRET = 'judge-secret-judge-secret-judge-secret32'
const encode = (secret: string) => new TextEncoder().encode(secret)

const organizer = createAccessTokenSigner(ORGANIZER_SECRET)
const judge = createJudgeTokenSigner(JUDGE_SECRET)
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600

async function organizerToken(alg: string, secret = ORGANIZER_SECRET) {
  return new SignJWT({ clubId: 'club-1', role: 'owner' })
    .setProtectedHeader({ alg })
    .setSubject('user-1')
    .setExpirationTime(inOneHour())
    .sign(encode(secret))
}

describe('jeton d’accès organisateur', () => {
  it('accepte un jeton signé par le serveur', async () => {
    const token = await organizer.sign({ sub: 'user-1', clubId: 'club-1', role: 'owner' })
    await expect(organizer.verify(token)).resolves.toEqual({ sub: 'user-1', clubId: 'club-1', role: 'owner' })
  })

  it.each([['HS384'], ['HS512']])(
    'refuse un jeton signé en %s avec le bon secret — seul HS256 est émis, seul HS256 est accepté',
    async (alg) => {
      await expect(organizer.verify(await organizerToken(alg))).rejects.toThrow()
    },
  )

  it('refuse un jeton signé avec un autre secret', async () => {
    await expect(organizer.verify(await organizerToken('HS256', 'un-autre-secret-un-autre-secret-32c'))).rejects.toThrow()
  })

  it('refuse un jeton non signé (alg none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: 'user-1', clubId: 'club-1', role: 'owner', exp: inOneHour() }),
    ).toString('base64url')
    await expect(organizer.verify(`${header}.${payload}.`)).rejects.toThrow()
  })

  it('refuse un jeton expiré', async () => {
    const expired = await new SignJWT({ clubId: 'club-1', role: 'owner' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(encode(ORGANIZER_SECRET))
    await expect(organizer.verify(expired)).rejects.toThrow()
  })

  it('refuse un jeton juge : les deux portées ne se mélangent jamais', async () => {
    const judgeToken = await judge.sign({ sub: 'judge-1', competitionId: 'comp-1' }, new Date(Date.now() + 3600_000))
    await expect(organizer.verify(judgeToken)).rejects.toThrow()
  })

  it('refuse un rôle inconnu', async () => {
    const token = await new SignJWT({ clubId: 'club-1', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime(inOneHour())
      .sign(encode(ORGANIZER_SECRET))
    await expect(organizer.verify(token)).rejects.toThrow()
  })
})

describe('jeton d’accès juge', () => {
  it('accepte un jeton signé par le serveur', async () => {
    const token = await judge.sign({ sub: 'judge-1', competitionId: 'comp-1' }, new Date(Date.now() + 3600_000))
    await expect(judge.verify(token)).resolves.toEqual({ sub: 'judge-1', competitionId: 'comp-1' })
  })

  it('refuse un jeton signé en HS512 avec le bon secret', async () => {
    const token = await new SignJWT({ competitionId: 'comp-1' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('judge-1')
      .setExpirationTime(inOneHour())
      .sign(encode(JUDGE_SECRET))
    await expect(judge.verify(token)).rejects.toThrow()
  })

  it('refuse un jeton organisateur', async () => {
    const token = await organizer.sign({ sub: 'user-1', clubId: 'club-1', role: 'owner' })
    await expect(judge.verify(token)).rejects.toThrow()
  })
})
