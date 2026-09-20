import { describe, expect, it } from 'vitest'

import {
  cropToPixels,
  FULL_CROP,
  isFullCrop,
  MIN_CROP_SIDE,
  moveCrop,
  resizeCrop,
  type CropRect,
} from './photo-crop'

const centered: CropRect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

function expectCrop(actual: CropRect, expected: CropRect) {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
  expect(actual.width).toBeCloseTo(expected.width, 6)
  expect(actual.height).toBeCloseTo(expected.height, 6)
}

describe('isFullCrop', () => {
  it('reconnaît la photo entière, à une tolérance près', () => {
    expect(isFullCrop(FULL_CROP)).toBe(true)
    expect(isFullCrop({ x: 0.0004, y: 0, width: 0.9996, height: 1 })).toBe(true)
  })

  it('refuse une zone plus petite que la photo', () => {
    expect(isFullCrop(centered)).toBe(false)
    expect(isFullCrop({ x: 0, y: 0, width: 1, height: 0.9 })).toBe(false)
    expect(isFullCrop({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false)
  })
})

describe('moveCrop', () => {
  it('translate la zone sans changer sa taille', () => {
    expectCrop(moveCrop(centered, 0.1, -0.05), { x: 0.35, y: 0.2, width: 0.5, height: 0.5 })
  })

  it('s’arrête au bord de la photo', () => {
    expectCrop(moveCrop(centered, 5, 5), { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })
    expectCrop(moveCrop(centered, -5, -5), { x: 0, y: 0, width: 0.5, height: 0.5 })
  })

  it('ne peut pas bouger une zone qui couvre déjà toute la photo', () => {
    expectCrop(moveCrop(FULL_CROP, 0.3, -0.3), FULL_CROP)
  })
})

describe('resizeCrop', () => {
  it('déplace le coin tiré et laisse le coin opposé fixe', () => {
    expectCrop(resizeCrop(centered, 'nw', -0.1, -0.05), {
      x: 0.15,
      y: 0.2,
      width: 0.6,
      height: 0.55,
    })
    expectCrop(resizeCrop(centered, 'se', 0.1, 0.05), {
      x: 0.25,
      y: 0.25,
      width: 0.6,
      height: 0.55,
    })
    expectCrop(resizeCrop(centered, 'ne', 0.1, -0.05), {
      x: 0.25,
      y: 0.2,
      width: 0.6,
      height: 0.55,
    })
    expectCrop(resizeCrop(centered, 'sw', -0.1, 0.05), {
      x: 0.15,
      y: 0.25,
      width: 0.6,
      height: 0.55,
    })
  })

  it('rogne quand on tire un coin vers l’intérieur', () => {
    expectCrop(resizeCrop(FULL_CROP, 'nw', 0.2, 0.3), { x: 0.2, y: 0.3, width: 0.8, height: 0.7 })
    expectCrop(resizeCrop(FULL_CROP, 'se', -0.2, -0.3), { x: 0, y: 0, width: 0.8, height: 0.7 })
  })

  it('ne sort jamais de la photo', () => {
    expectCrop(resizeCrop(centered, 'nw', -5, -5), { x: 0, y: 0, width: 0.75, height: 0.75 })
    expectCrop(resizeCrop(centered, 'se', 5, 5), { x: 0.25, y: 0.25, width: 0.75, height: 0.75 })
  })

  it('garde une taille minimale dans chaque sens, sans croiser les bords', () => {
    expectCrop(resizeCrop(centered, 'nw', 5, 5), {
      x: 0.75 - MIN_CROP_SIDE,
      y: 0.75 - MIN_CROP_SIDE,
      width: MIN_CROP_SIDE,
      height: MIN_CROP_SIDE,
    })
    expectCrop(resizeCrop(centered, 'se', -5, -5), {
      x: 0.25,
      y: 0.25,
      width: MIN_CROP_SIDE,
      height: MIN_CROP_SIDE,
    })
  })

  it('un coin ne modifie que les bords qu’il porte', () => {
    // Tirer le coin nord-ouest ne touche ni le bord droit ni le bord bas.
    const resized = resizeCrop(centered, 'nw', 0.05, 0.05)
    expect(resized.x + resized.width).toBeCloseTo(0.75, 6)
    expect(resized.y + resized.height).toBeCloseTo(0.75, 6)
  })
})

describe('cropToPixels', () => {
  it('convertit la zone en pixels entiers', () => {
    expect(cropToPixels(centered, 4000, 3000)).toEqual({ sx: 1000, sy: 750, sw: 2000, sh: 1500 })
  })

  it('la photo entière donne l’image entière', () => {
    expect(cropToPixels(FULL_CROP, 4000, 3000)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000 })
  })

  it('arrondit sans jamais sortir de l’image ni descendre sous 1 pixel', () => {
    expect(cropToPixels({ x: 0.999, y: 0.999, width: 0.001, height: 0.001 }, 100, 100)).toEqual({
      sx: 99,
      sy: 99,
      sw: 1,
      sh: 1,
    })
    expect(cropToPixels({ x: 0, y: 0, width: 0.001, height: 0.001 }, 100, 100)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1,
      sh: 1,
    })
    expect(cropToPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 101, 57)).toEqual({
      sx: 91,
      sy: 51,
      sw: 10,
      sh: 6,
    })
  })
})
