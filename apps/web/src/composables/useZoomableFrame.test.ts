import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useZoomableFrame, type ZoomableFrame } from './useZoomableFrame'

/** Monte le composable dans un composant : il pose un `onBeforeUnmount`. */
function mountFrame(): { frame: ZoomableFrame; scroller: Ref<HTMLElement | null> } {
  let captured: { frame: ZoomableFrame; scroller: Ref<HTMLElement | null> } | null = null
  mount(
    defineComponent({
      setup() {
        const scroller = ref<HTMLElement | null>(null)
        captured = { frame: useZoomableFrame(scroller), scroller }
        return () => null
      },
    }),
  )
  if (!captured) throw new Error('composable non monté')
  return captured
}

function fakeImage(naturalWidth: number, naturalHeight: number): Event {
  return { target: { naturalWidth, naturalHeight } } as unknown as Event
}

describe('useZoomableFrame', () => {
  it('retombe sur un pourcentage tant que les tailles sont inconnues', () => {
    const { frame } = mountFrame()

    // jsdom ne mesure rien et n'a pas de ResizeObserver : c'est le repli.
    expect(frame.frameWidth.value).toBe('100%')
    frame.zoom.value = 3
    expect(frame.frameWidth.value).toBe('300%')
  })

  it('fait tenir la photo entière à ×1, puis la multiplie par le zoom', async () => {
    const { frame, scroller } = mountFrame()
    const element = document.createElement('div')
    // 848 - 48 de rembourrage = 800 de large, 448 - 48 = 400 de haut.
    Object.defineProperty(element, 'clientWidth', { value: 848 })
    Object.defineProperty(element, 'clientHeight', { value: 448 })
    scroller.value = element
    await nextTick()

    // Une photo deux fois plus haute que large : c'est la hauteur qui bute.
    frame.onImageLoad(fakeImage(500, 1000))
    expect(frame.frameWidth.value).toBe('200px')

    await frame.setZoom(2)
    expect(frame.frameWidth.value).toBe('400px')
  })

  it('garde au centre de l’écran ce qui y était', async () => {
    const { frame, scroller } = mountFrame()
    const element = document.createElement('div')
    Object.defineProperty(element, 'clientWidth', { value: 100 })
    Object.defineProperty(element, 'clientHeight', { value: 100 })
    Object.defineProperty(element, 'scrollWidth', { value: 200 })
    Object.defineProperty(element, 'scrollHeight', { value: 200 })
    element.scrollLeft = 50
    element.scrollTop = 50
    scroller.value = element
    await nextTick()

    // Centre visible à (100/200) : après zoom, on le remet au milieu.
    await frame.setZoom(2)
    expect(element.scrollLeft).toBe(50)
    expect(element.scrollTop).toBe(50)
  })

  it('ignore une image de hauteur nulle plutôt que de diviser par zéro', async () => {
    const { frame, scroller } = mountFrame()
    const element = document.createElement('div')
    Object.defineProperty(element, 'clientWidth', { value: 848 })
    Object.defineProperty(element, 'clientHeight', { value: 448 })
    scroller.value = element
    await nextTick()

    frame.onImageLoad(fakeImage(500, 0))
    expect(frame.frameWidth.value).toBe('100%')
  })
})
