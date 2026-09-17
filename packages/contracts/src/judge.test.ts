import { describe, expect, it } from 'vitest'

import { createJudgeInputSchema, judgeAuthInputSchema } from './judge'

describe('createJudgeInputSchema', () => {
  const valid = { displayName: 'Juge Voie 1', routeIds: ['0189dcd5-5311-7d40-8db0-9496a2eef37b'] }

  it('accepte un juge avec au moins une voie', () => {
    expect(createJudgeInputSchema.safeParse(valid).success).toBe(true)
  })

  it('refuse un juge sans aucune voie assignée', () => {
    expect(createJudgeInputSchema.safeParse({ ...valid, routeIds: [] }).success).toBe(false)
  })

  it('refuse un nom vide', () => {
    expect(createJudgeInputSchema.safeParse({ ...valid, displayName: '  ' }).success).toBe(false)
  })

  it('accepte un e-mail optionnel', () => {
    expect(
      createJudgeInputSchema.safeParse({ ...valid, email: 'juge@club-demo.test' }).success,
    ).toBe(true)
  })

  it('refuse un e-mail mal formé', () => {
    expect(createJudgeInputSchema.safeParse({ ...valid, email: 'pas-un-email' }).success).toBe(
      false,
    )
  })
})

describe('judgeAuthInputSchema', () => {
  it('accepte un jeton seul, sans PIN', () => {
    expect(judgeAuthInputSchema.safeParse({ token: 'un-jeton' }).success).toBe(true)
  })

  it('accepte un jeton avec un PIN à 6 chiffres', () => {
    expect(judgeAuthInputSchema.safeParse({ token: 'un-jeton', pin: '123456' }).success).toBe(true)
  })

  it('refuse un PIN qui ne fait pas 6 chiffres', () => {
    expect(judgeAuthInputSchema.safeParse({ token: 'un-jeton', pin: '123' }).success).toBe(false)
  })

  it('refuse un PIN non numérique', () => {
    expect(judgeAuthInputSchema.safeParse({ token: 'un-jeton', pin: 'abcdef' }).success).toBe(false)
  })

  it('refuse un jeton vide', () => {
    expect(judgeAuthInputSchema.safeParse({ token: '' }).success).toBe(false)
  })
})
