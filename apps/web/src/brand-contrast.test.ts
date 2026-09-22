import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Garde-fou de la charte (ADR-071) : les échelles Tailwind sont re-teintées
 * dans `style.css`. Ce test lit les valeurs RÉELLES du fichier et vérifie le
 * contraste WCAG de chaque couple texte/fond utilisé dans l'application.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'style.css'), 'utf8')

const tokens = new Map<string, string>([['white', '#ffffff']])
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)) {
  const [, name, hex] = match
  if (name && hex) tokens.set(name, hex)
}

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(name: string): number {
  const hex = tokens.get(name)
  if (!hex) throw new Error(`Jeton de couleur absent de style.css : ${name}`)
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  if (light === undefined || dark === undefined) throw new Error('unreachable')
  return (light + 0.05) / (dark + 0.05)
}

// [texte, fond] — texte courant : AA = 4,5:1.
const TEXT_PAIRS: [string, string][] = [
  // Marque
  ['white', 'blue-700'],
  ['white', 'blue-800'],
  ['white', 'navy-deep'],
  ['blue-700', 'white'],
  ['blue-700', 'paper'],
  ['blue-700', 'blue-50'],
  ['blue-800', 'blue-100'],
  ['ink', 'paper'],
  // Erreur / danger
  ['red-700', 'white'],
  ['red-700', 'paper'],
  ['red-700', 'red-50'],
  ['red-800', 'red-100'],
  ['red-900', 'red-50'],
  ['red-900', 'red-100'],
  ['white', 'red-700'],
  ['white', 'red-600'],
  ['white', 'red-800'],
  // Avertissement
  ['amber-900', 'amber-50'],
  ['amber-800', 'amber-50'],
  ['amber-900', 'amber-100'],
  ['amber-800', 'amber-100'],
  ['amber-700', 'white'],
  // Confirmé
  ['green-900', 'green-50'],
  ['green-800', 'green-50'],
  ['green-800', 'green-100'],
  ['green-700', 'white'],
  ['white', 'green-700'],
  // Neutres
  ['gray-900', 'white'],
  ['gray-900', 'paper'],
  ['gray-600', 'white'],
  ['gray-600', 'paper'],
  ['gray-600', 'gray-50'],
  ['gray-600', 'gray-100'],
  ['gray-700', 'gray-100'],
  ['gray-900', 'gray-100'],
  ['gray-500', 'white'],
  ['gray-500', 'paper'],
  // Tableaux de l'espace organisateur (Lot 18)
  ['gray-700', 'gray-50'],
  ['gray-900', 'gray-50'],
  ['gray-900', 'blue-50'],
  ['gray-600', 'blue-50'],
  // Écran de salle (fond sombre)
  ['white', 'gray-900'],
  ['gray-300', 'gray-900'],
  ['gray-400', 'gray-900'],
  ['amber-400', 'gray-900'],
]

// Grand texte gras (bouton TOP du juge) et pastilles d'état : 3:1.
const LARGE_OR_NON_TEXT_PAIRS: [string, string][] = [
  ['white', 'green-600'],
  ['green-600', 'white'],
  ['amber-600', 'white'],
  ['red-600', 'white'],
]

describe('charte — contrastes WCAG des échelles re-teintées (ADR-071)', () => {
  it.each(TEXT_PAIRS)('%s sur %s ≥ 4,5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LARGE_OR_NON_TEXT_PAIRS)('%s sur %s ≥ 3:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(3)
  })

  it('blue-700 est exactement le navy de la marque', () => {
    expect(tokens.get('blue-700')).toBe(tokens.get('navy'))
  })
})

/*
 * La variante supprimée, toutes les classes `fine:` retomberaient en silence :
 * rien ne casserait à l'écran, les tableaux redeviendraient simplement larges.
 * D'où ce test.
 */
describe('densité compacte à la souris (ADR-073)', () => {
  const variant = /@custom-variant fine \(([^)]*\)?[^;]*)\);/.exec(css)?.[1] ?? ''

  it('déclare la variante fine', () => {
    expect(variant).not.toBe('')
  })

  it('ne se déclenche qu’avec un pointeur fin', () => {
    expect(variant).toContain('pointer: fine')
  })

  it('exclut tout appareil où le doigt reste possible', () => {
    expect(variant).toContain('not (any-pointer: coarse)')
  })
})
