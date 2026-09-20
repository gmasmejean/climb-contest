import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fitWithin, resizeToJpeg } from './photo-resize'

describe('fitWithin', () => {
  it('ramène le grand côté à la limite en gardant les proportions', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('n’agrandit jamais une image déjà plus petite', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 })
  })

  it('arrondit à des pixels entiers, au moins 1', () => {
    expect(fitWithin(1601, 1000, 1600)).toEqual({ width: 1600, height: 999 })
    expect(fitWithin(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
  })
})

describe('resizeToJpeg — recadrage', () => {
  const drawImage = vi.fn()
  let canvas: { width: number; height: number }

  beforeEach(() => {
    drawImage.mockReset()
    // jsdom n'a ni décodeur d'image ni canvas : on simule les deux, pour vérifier
    // CE QUE `resizeToJpeg` demande au canvas (zone source, taille cible).
    const bitmap = { width: 4000, height: 3000, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    canvas = { width: 0, height: 0 }
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage }
    vi.spyOn(document, 'createElement').mockImplementation(
      () =>
        Object.assign(canvas, {
          getContext: () => context,
          toBlob: (done: (blob: Blob | null) => void) => done(new Blob([new Uint8Array([0xff])])),
        }) as unknown as HTMLElement,
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sans zone : dessine toute l’image, réduite à 1600 px', async () => {
    await resizeToJpeg(new Blob(['x']))

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4000, 3000, 0, 0, 1600, 1200)
    expect(canvas).toMatchObject({ width: 1600, height: 1200 })
  })

  it('avec une zone : recadre dans l’image d’origine PUIS réduit (résolution de la zone gardée)', async () => {
    await resizeToJpeg(new Blob(['x']), { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })

    // Zone de 2000 × 1500 px prise dans l'original, puis ramenée à 1600 × 1200.
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      1000,
      750,
      2000,
      1500,
      0,
      0,
      1600,
      1200,
    )
    expect(canvas).toMatchObject({ width: 1600, height: 1200 })
  })

  it('une petite zone n’est jamais agrandie', async () => {
    await resizeToJpeg(new Blob(['x']), { crop: { x: 0, y: 0, width: 0.1, height: 0.1 } })

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 400, 300, 0, 0, 400, 300)
    expect(canvas).toMatchObject({ width: 400, height: 300 })
  })

  it('une zone « null » vaut la photo entière', async () => {
    await resizeToJpeg(new Blob(['x']), { crop: null })

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 4000, 3000, 0, 0, 1600, 1200)
  })
})
