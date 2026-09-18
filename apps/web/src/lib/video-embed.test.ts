import { describe, expect, it } from 'vitest'

import { parseVideoEmbed } from './video-embed'

describe('parseVideoEmbed — YouTube', () => {
  it('accepte un lien youtu.be', () => {
    expect(parseVideoEmbed('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      provider: 'youtube',
      embedSrc: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    })
  })

  it('accepte un lien youtube.com/watch?v=', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toEqual({
      provider: 'youtube',
      embedSrc: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    })
  })

  it('accepte un lien /shorts/', () => {
    expect(parseVideoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ')?.provider).toBe('youtube')
  })
})

describe('parseVideoEmbed — Vimeo', () => {
  it('accepte un lien vimeo.com/<id>', () => {
    expect(parseVideoEmbed('https://vimeo.com/76979871')).toEqual({
      provider: 'vimeo',
      embedSrc: 'https://player.vimeo.com/video/76979871',
    })
  })
})

describe('parseVideoEmbed — refus (sécurité et robustesse)', () => {
  it('refuse une URL mal formée', () => {
    expect(parseVideoEmbed('pas-une-url')).toBeNull()
  })

  it('refuse un domaine usurpé (sous-domaine trompeur)', () => {
    expect(parseVideoEmbed('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
  })

  it('refuse un schéma non http(s)', () => {
    expect(parseVideoEmbed('javascript:alert(1)')).toBeNull()
  })

  it('refuse un domaine hors liste', () => {
    expect(parseVideoEmbed('https://example.com/video/123')).toBeNull()
  })

  it('refuse un lien youtube.com sans identifiant exploitable', () => {
    expect(parseVideoEmbed('https://www.youtube.com/watch')).toBeNull()
    expect(parseVideoEmbed('https://www.youtube.com/')).toBeNull()
  })
})
