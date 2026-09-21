import blueTexture from '../../assets/landing/card-blue.webp'
import coralTexture from '../../assets/landing/card-coral.webp'
import greenTexture from '../../assets/landing/card-green.webp'
import yellowTexture from '../../assets/landing/card-yellow.webp'

export type WatercolorTone = 'yellow' | 'green' | 'blue' | 'coral'

// Couleur unie sous la texture : visible le temps du chargement (les images
// ne sont pas précachées, ADR-070).
export const TONE_CLASS = {
  yellow: 'bg-card-yellow',
  green: 'bg-card-green',
  blue: 'bg-card-blue',
  coral: 'bg-card-coral',
} as const satisfies Record<WatercolorTone, string>

const TEXTURE = {
  yellow: yellowTexture,
  green: greenTexture,
  blue: blueTexture,
  coral: coralTexture,
} as const satisfies Record<WatercolorTone, string>

// Voile blanc de 25 % sous le texte : sans lui, les coins foncés des textures
// vert, bleu et corail passent sous 4,5:1 avec l'encre (AA, CLAUDE.md § 4).
const VEIL = 'linear-gradient(rgb(255 255 255 / 0.25), rgb(255 255 255 / 0.25))'

export function watercolorBackground(tone: WatercolorTone): string {
  return `${VEIL}, url(${TEXTURE[tone]})`
}
