import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import PhotoCropDialog from './PhotoCropDialog.vue'

const mounted: VueWrapper[] = []

function mountDialog(
  props: {
    open?: boolean
    crop?: { x: number; y: number; width: number; height: number } | null
  } = {},
) {
  const wrapper = mount(PhotoCropDialog, {
    attachTo: document.body,
    props: { open: true, imageUrl: 'blob:photo', crop: null, ...props },
  })
  mounted.push(wrapper)
  return wrapper
}

// Le dialogue est téléporté dans <body> : on le lit là.
const root = () => document.body.querySelector('[data-testid="photo-crop-dialog"]')
const button = (label: string) =>
  [...(root()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)
const handle = (corner: string) =>
  root()?.querySelector<HTMLElement>(`[data-testid="crop-handle"][data-corner="${corner}"]`)
const area = () => root()?.querySelector<HTMLElement>('[data-testid="crop-area"]')

function keydown(target: HTMLElement | null | undefined, key: string, shiftKey = false) {
  target?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('PhotoCropDialog', () => {
  it('ne rend rien tant qu’il est fermé', () => {
    mountDialog({ open: false })
    expect(root()).toBeNull()
  })

  it('propose quatre coins de 48 px et une zone qui couvre d’abord toute la photo', () => {
    mountDialog()

    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      expect(handle(corner)?.className).toContain('h-12')
      expect(handle(corner)?.className).toContain('w-12')
    }
    expect(area()?.style.left).toBe('0%')
    expect(area()?.style.width).toBe('100%')
    expect(area()?.style.height).toBe('100%')
  })

  it('repart de la zone déjà choisie', () => {
    mountDialog({ crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 } })

    expect(area()?.style.left).toBe('20%')
    expect(area()?.style.top).toBe('10%')
    expect(area()?.style.width).toBe('50%')
    expect(area()?.style.height).toBe('60%')
  })

  it('tire un coin aux flèches du clavier, le coin opposé reste fixe', async () => {
    const wrapper = mountDialog()

    keydown(handle('nw'), 'ArrowRight', true)
    keydown(handle('nw'), 'ArrowDown', true)
    await wrapper.vm.$nextTick()
    button('Appliquer le recadrage')?.click()

    const [crop] = wrapper.emitted('apply')?.[0] ?? []
    expect(crop).toMatchObject({ x: 0.05, y: 0.05 })
    expect((crop as { width: number }).width).toBeCloseTo(0.95, 6)
    expect((crop as { height: number }).height).toBeCloseTo(0.95, 6)
  })

  it('déplace la zone aux flèches, sans la sortir de la photo', async () => {
    const wrapper = mountDialog({ crop: { x: 0.4, y: 0.4, width: 0.6, height: 0.6 } })

    keydown(area(), 'ArrowRight', true)
    keydown(area(), 'ArrowUp', true)
    await wrapper.vm.$nextTick()
    button('Appliquer le recadrage')?.click()

    const [crop] = wrapper.emitted('apply')?.[0] ?? []
    // À droite : déjà au bord, la zone ne bouge pas ; vers le haut : elle monte de 5 %.
    expect(crop).toMatchObject({ x: 0.4, width: 0.6 })
    expect((crop as { y: number }).y).toBeCloseTo(0.35, 6)
  })

  it('appliquer sans avoir rien changé renvoie « photo entière » (null)', () => {
    const wrapper = mountDialog()

    button('Appliquer le recadrage')?.click()

    expect(wrapper.emitted('apply')).toEqual([[null]])
  })

  it('« Garder la photo entière » remet la zone à 100 % et se désactive alors', async () => {
    const wrapper = mountDialog({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } })
    expect(button('Garder la photo entière')?.hasAttribute('disabled')).toBe(false)

    button('Garder la photo entière')?.click()
    await wrapper.vm.$nextTick()

    expect(area()?.style.width).toBe('100%')
    expect(button('Garder la photo entière')?.hasAttribute('disabled')).toBe(true)
  })

  it('zoome par boutons ×1 / ×2 / ×3', async () => {
    const wrapper = mountDialog()
    const frame = () => root()?.querySelector<HTMLElement>('[data-testid="crop-frame"]')
    expect(frame()?.style.width).toBe('100%')

    button('×3')?.click()
    await wrapper.vm.$nextTick()

    expect(frame()?.style.width).toBe('300%')
    expect(button('×3')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('« Annuler » et Échap ferment sans rien appliquer', () => {
    const wrapper = mountDialog()

    button('Annuler')?.click()
    keydown(root() as HTMLElement, 'Escape')

    expect(wrapper.emitted('close')).toHaveLength(2)
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('remet la zone reçue à chaque ouverture (une annulation ne laisse rien)', async () => {
    const wrapper = mountDialog({ crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } })
    keydown(handle('se'), 'ArrowLeft', true)
    await wrapper.vm.$nextTick()

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(area()?.style.width).toBe('50%')
  })
})
