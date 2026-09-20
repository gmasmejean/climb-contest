import type { RoutePhoto } from '@climbcontest/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { judgeDb } from '../../judge/local-db'
import { flushLiveQueries } from '../../test-utils/flush'
import RoutePhotoPanel from './RoutePhotoPanel.vue'

const ASSET_ID = '00000000-0000-4000-8000-0000000000c1'
const photo: RoutePhoto = {
  assetId: ASSET_ID,
  holds: [
    { number: 1, x: 0.5, y: 0.9 },
    { number: 2, x: 0.4, y: 0.5 },
    { number: 3, x: 0.9, y: 0.2 },
  ],
}

async function storePhoto(assetId = ASSET_ID) {
  await judgeDb.routePhotos.put({
    routeId: 'route-1',
    assetId,
    mimeType: 'image/jpeg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]).buffer,
  })
}

// Un composant resté monté écoute encore IndexedDB : on démonte tout après chaque
// test, sans quoi il réagit aux écritures du test suivant.
const mounted: ReturnType<typeof mount>[] = []

async function mountPanel(overrides: Partial<{ open: boolean; photo: RoutePhoto }> = {}) {
  const wrapper = mount(RoutePhotoPanel, {
    props: { routeId: 'route-1', routeNumber: 3, photo, open: true, ...overrides },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  await flushLiveQueries()
  return wrapper
}

const buttonNamed = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)

describe('RoutePhotoPanel', () => {
  let created: string[]
  let revoked: string[]

  beforeEach(async () => {
    await judgeDb.routePhotos.clear()
    created = []
    revoked = []
    URL.createObjectURL = vi.fn(() => {
      const url = `blob:photo-${created.length}`
      created.push(url)
      return url
    })
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url)
    })
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('affiche la photo lue dans IndexedDB avec un cercle numéroté par prise', async () => {
    await storePhoto()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const wrapper = await mountPanel()

    expect(wrapper.find('img').attributes('src')).toBe('blob:photo-0')
    const numbers = wrapper.findAll('[data-testid="hold-marker"]').map((m) => m.text())
    expect(numbers).toEqual(['1', '2', '3'])
    // Aucun accès réseau pour afficher la voie (CLAUDE.md, règle 2).
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('place chaque prise selon ses coordonnées normalisées', async () => {
    await storePhoto()
    const wrapper = await mountPanel()

    const first = wrapper.find('[data-number="1"]').attributes('style')
    expect(first).toContain('left: 50%')
    expect(first).toContain('top: 90%')
  })

  it('met le numéro à gauche de la prise près du bord droit de la photo', async () => {
    await storePhoto()
    const wrapper = await mountPanel()

    const nearEdge = wrapper.find('[data-number="3"]').findAll('span')[1]
    const inside = wrapper.find('[data-number="1"]').findAll('span')[1]
    expect(nearEdge?.classes()).toContain('right-[18px]')
    expect(inside?.classes()).toContain('left-[18px]')
  })

  it('ne rend rien tant que le panneau est fermé', async () => {
    await storePhoto()
    const wrapper = await mountPanel({ open: false })

    expect(wrapper.find('[data-testid="route-photo-panel"]').exists()).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('le bouton « Masquer la voie » ferme le panneau', async () => {
    await storePhoto()
    const wrapper = await mountPanel()

    await buttonNamed(wrapper, 'Masquer la voie')?.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('la touche Échap ferme le panneau', async () => {
    await storePhoto()
    const wrapper = await mountPanel()

    await wrapper.find('[data-testid="route-photo-panel"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('un balayage vers la droite ferme le panneau, en plus du bouton', async () => {
    await storePhoto()
    const wrapper = await mountPanel()
    const panel = wrapper.find('[data-testid="route-photo-panel"]')

    await panel.trigger('touchstart', { touches: [{ clientX: 40, clientY: 300 }] })
    await panel.trigger('touchend', { changedTouches: [{ clientX: 220, clientY: 310 }] })

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it.each([
    ['vers la gauche', 220, 40, 300, 300],
    ['trop court', 40, 90, 300, 300],
    ['surtout vertical', 40, 160, 100, 400],
  ])('un balayage %s ne ferme pas le panneau', async (_label, x0, x1, y0, y1) => {
    await storePhoto()
    const wrapper = await mountPanel()
    const panel = wrapper.find('[data-testid="route-photo-panel"]')

    await panel.trigger('touchstart', { touches: [{ clientX: x0, clientY: y0 }] })
    await panel.trigger('touchend', { changedTouches: [{ clientX: x1, clientY: y1 }] })

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('zoomé, un glissement horizontal sert à se déplacer et ne ferme pas le panneau', async () => {
    await storePhoto()
    const wrapper = await mountPanel()
    await buttonNamed(wrapper, '×2')?.trigger('click')
    const panel = wrapper.find('[data-testid="route-photo-panel"]')

    await panel.trigger('touchstart', { touches: [{ clientX: 40, clientY: 300 }] })
    await panel.trigger('touchend', { changedTouches: [{ clientX: 260, clientY: 300 }] })

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('les boutons de zoom agrandissent la photo, et le niveau courant est annoncé', async () => {
    await storePhoto()
    const wrapper = await mountPanel()
    const frame = () => wrapper.find('img').element.parentElement

    expect(frame()?.style.width).toBe('100%')
    await buttonNamed(wrapper, '×3')?.trigger('click')
    expect(frame()?.style.width).toBe('300%')
    expect(buttonNamed(wrapper, '×3')?.attributes('aria-pressed')).toBe('true')
    expect(buttonNamed(wrapper, '×1')?.attributes('aria-pressed')).toBe('false')
  })

  it('dit quoi faire quand la photo n’est pas encore sur l’appareil', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').text()).toContain('pas encore sur cet appareil')
    expect(wrapper.find('[role="status"]').text()).toContain('continuer à saisir')
  })

  it('n’affiche pas une ancienne image qui ne correspond plus aux prises annoncées', async () => {
    await storePhoto('00000000-0000-4000-8000-0000000000c9')
    const wrapper = await mountPanel()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('libère l’adresse locale de l’image à la fermeture de l’écran', async () => {
    await storePhoto()
    const wrapper = await mountPanel()
    expect(created).toHaveLength(1)

    wrapper.unmount()

    expect(revoked).toEqual(['blob:photo-0'])
  })

  it('signale qu’aucun numéro n’est placé sur la photo', async () => {
    await storePhoto()
    const wrapper = await mountPanel({ photo: { assetId: ASSET_ID, holds: [] } })

    expect(wrapper.text()).toContain('Aucun numéro de prise')
  })
})
