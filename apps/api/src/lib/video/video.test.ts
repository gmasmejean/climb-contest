import { describe, expect, it } from 'vitest'

import { parseRange } from './range'
import { sniffVideoType } from './sniff'

const text = (value: string) => new Uint8Array([...value].map((c) => c.charCodeAt(0)))
const ftyp = (brand: string) =>
  new Uint8Array([0, 0, 0, 0x18, ...text('ftyp'), ...text(brand), 0, 0, 0, 0])

describe('sniffVideoType', () => {
  it.each([['isom'], ['mp42'], ['avc1'], ['M4V '], ['dash']])(
    'reconnaît un MP4 (marque %s)',
    (brand) => {
      expect(sniffVideoType(ftyp(brand))).toBe('video/mp4')
    },
  )

  it('reconnaît un fichier QuickTime (.mov)', () => {
    expect(sniffVideoType(ftyp('qt  '))).toBe('video/quicktime')
  })

  it('reconnaît un WebM, DocType compris', () => {
    const head = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, ...text('webm')])
    expect(sniffVideoType(head)).toBe('video/webm')
  })

  it('refuse un Matroska qui n’est pas du WebM', () => {
    const head = new Uint8Array([
      0x1a,
      0x45,
      0xdf,
      0xa3,
      0x9f,
      0x42,
      0x82,
      0x88,
      ...text('matroska'),
    ])
    expect(sniffVideoType(head)).toBeNull()
  })

  it.each([['heic'], ['avif'], ['mif1']])(
    'refuse une IMAGE dans le même conteneur (%s)',
    (brand) => {
      expect(sniffVideoType(ftyp(brand))).toBeNull()
    },
  )

  it.each([
    ['un PDF', text('%PDF-1.7 blabla blabla')],
    ['un exécutable', new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff])],
    ['une page HTML', text('<html><body>video.mp4</body></html>')],
    ['un fichier vide', new Uint8Array()],
    ['un fichier trop court', text('ftyp')],
    ['« ftyp » au mauvais endroit', text('ftypisom....')],
  ])('refuse %s, quelle que soit son extension', (_label, head) => {
    expect(sniffVideoType(head)).toBeNull()
  })
})

describe('parseRange', () => {
  it('sans en-tête, renvoie tout', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'none' })
    expect(parseRange('', 100)).toEqual({ kind: 'none' })
  })

  it.each([
    ['bytes=0-9', 100, { start: 0, end: 9 }],
    ['bytes=10-', 100, { start: 10, end: 99 }],
    ['bytes=-10', 100, { start: 90, end: 99 }],
    ['bytes=0-999', 100, { start: 0, end: 99 }],
    ['bytes=99-99', 100, { start: 99, end: 99 }],
    ['bytes=-1000', 100, { start: 0, end: 99 }],
  ])('%s sur %i octets', (header, size, range) => {
    expect(parseRange(header, size)).toEqual({ kind: 'partial', range })
  })

  it.each([['bytes=100-'], ['bytes=100-200'], ['bytes=-0'], ['bytes=500-600']])(
    '%s est insatisfaisable (416)',
    (header) => {
      expect(parseRange(header, 100)).toEqual({ kind: 'unsatisfiable' })
    },
  )

  it.each([
    ['plusieurs plages', 'bytes=0-1,5-6'],
    ['une unité inconnue', 'items=0-1'],
    ['du texte', 'oups'],
    ['une plage inversée', 'bytes=9-2'],
    ['une plage vide', 'bytes=-'],
  ])('ignore %s : la réponse complète reste valable', (_label, header) => {
    expect(parseRange(header, 100)).toEqual({ kind: 'none' })
  })

  it('un objet vide ne satisfait aucune plage de suffixe', () => {
    expect(parseRange('bytes=-5', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})
