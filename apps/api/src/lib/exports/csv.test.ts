import { describe, expect, it } from 'vitest'

import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('laisse un texte simple tel quel', () => {
    expect(csvCell('Léa Martin')).toBe('Léa Martin')
  })

  it('met entre guillemets et double les guillemets', () => {
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""')
  })

  it.each([['a;b'], ['a\nb'], ['a\rb']])('met %j entre guillemets', (value) => {
    expect(csvCell(value)).toBe(`"${value}"`)
  })

  it('rend les valeurs absentes vides', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it.each([['=1+1'], ['+33 6 12'], ['-2'], ['@SUM(A1)'], ['\tx']])(
    'neutralise une formule potentielle dans un TEXTE : %j',
    (value) => {
      expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true)
    },
  )

  it('neutralise avant de quoter (préfixe apostrophe puis guillemets)', () => {
    expect(csvCell('=HYPERLINK("http://x";"y")')).toBe(`"'=HYPERLINK(""http://x"";""y"")"`)
  })

  it('ne touche pas un NOMBRE, même négatif', () => {
    expect(csvCell(12)).toBe('12')
    expect(csvCell(-3)).toBe('-3')
  })
})

describe('toCsv', () => {
  it('commence par un BOM UTF-8, sépare par « ; » et termine les lignes par CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        [1, null],
      ]),
    ).toBe('﻿a;b\r\n1;\r\n')
  })
})
