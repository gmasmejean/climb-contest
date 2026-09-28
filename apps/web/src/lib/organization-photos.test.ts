import { describe, expect, it } from 'vitest'

import {
  describeSkipped,
  galleryPhotos,
  movePhoto,
  photoAlt,
  planUploads,
  publicPhotoUrl,
} from './organization-photos'

describe('photoAlt', () => {
  it('reprend le texte saisi, sinon annonce la place de la photo', () => {
    expect(photoAlt({ altText: 'Le mur de bloc' }, 0, 3, 'Club Roc')).toBe('Le mur de bloc')
    expect(photoAlt({ altText: null }, 1, 3, 'Club Roc')).toBe('Photo 2 sur 3 de Club Roc')
  })
})

describe('galleryPhotos', () => {
  it('garde l’ordre et laisse `src` à null tant que l’image n’est pas chargée', () => {
    const photos = [
      { id: 'a', altText: null },
      { id: 'b', altText: 'Accueil' },
    ]
    expect(galleryPhotos(photos, 'Club Roc', (id) => (id === 'a' ? 'blob:a' : null))).toEqual([
      { id: 'a', alt: 'Photo 1 sur 2 de Club Roc', caption: null, src: 'blob:a' },
      { id: 'b', alt: 'Accueil', caption: 'Accueil', src: null },
    ])
  })
})

describe('publicPhotoUrl', () => {
  it('passe par la compétition affichée', () => {
    expect(publicPhotoUrl('abc123', 'p1')).toBe('/api/v1/public/abc123/organization/photos/p1')
  })
})

describe('movePhoto', () => {
  const ids = ['a', 'b', 'c']

  it('monte ou descend une photo d’un cran', () => {
    expect(movePhoto(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(movePhoto(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('ne fait rien au bout de la liste ni pour une photo absente', () => {
    expect(movePhoto(ids, 'a', -1)).toBeNull()
    expect(movePhoto(ids, 'c', 1)).toBeNull()
    expect(movePhoto(ids, 'z', 1)).toBeNull()
  })
})

describe('planUploads', () => {
  it('garde les premiers fichiers qui tiennent dans les six places', () => {
    expect(planUploads(['1', '2', '3'], 0)).toEqual({ accepted: ['1', '2', '3'], skipped: 0 })
    expect(planUploads(['1', '2', '3'], 4)).toEqual({ accepted: ['1', '2'], skipped: 1 })
    expect(planUploads(['1'], 6)).toEqual({ accepted: [], skipped: 1 })
  })

  it('dit combien de photos ont été laissées', () => {
    expect(describeSkipped(0)).toBe('')
    expect(describeSkipped(1)).toBe('1 photo n’a pas été ajoutée : la fiche en compte 6 au plus.')
    expect(describeSkipped(2)).toBe(
      '2 photos n’ont pas été ajoutées : la fiche en compte 6 au plus.',
    )
  })
})
