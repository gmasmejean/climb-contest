import type { RouteHold } from '@climbcontest/contracts'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HoldAnnotatorDialog from './HoldAnnotatorDialog.vue'

const mounted: VueWrapper[] = []

function mountDialog(open = true, holds: RouteHold[] = []) {
  const wrapper = mount(HoldAnnotatorDialog, {
    attachTo: document.body,
    props: {
      open,
      imageUrl: 'blob:photo',
      routeNumber: 7,
      holdCount: null,
      modelValue: holds,
      'onUpdate:modelValue': (value: RouteHold[]) => wrapper.setProps({ modelValue: value }),
    },
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('HoldAnnotatorDialog', () => {
  it('reste fermé tant qu’on ne l’ouvre pas', () => {
    mountDialog(false)
    expect(document.querySelector('[data-testid="hold-annotator-dialog"]')).toBeNull()
  })

  it('ouvre un dialogue modal nommé, avec le zoom', async () => {
    mountDialog()
    await nextTick()

    const dialog = document.querySelector('[data-testid="hold-annotator-dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.textContent).toContain('voie 7')
    const zoom = dialog?.querySelector('[role="group"][aria-label="Zoom"]')
    expect(zoom?.querySelectorAll('button')).toHaveLength(3)
  })

  it('donne le focus à « Fermer », et le rend à l’ouvrant en se fermant', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await nextTick()
    await nextTick()
    expect(document.activeElement?.textContent).toContain('Fermer')

    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('demande sa fermeture sur Échap et sur « Fermer »', async () => {
    const wrapper = mountDialog()
    await nextTick()

    // Depuis le corps de page : après avoir touché la photo, le focus n'est
    // plus dans le dialogue, et un écouteur local ne verrait rien passer.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)

    const dialog = document.querySelector('[data-testid="hold-annotator-dialog"]')

    dialog?.querySelector<HTMLElement>('[data-close]')?.click()
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  it('remonte les prises posées en grand : c’est le même v-model', async () => {
    const wrapper = mountDialog(true, [{ number: 1, x: 0.1, y: 0.2 }])
    await nextTick()

    const frame = document.querySelector('[data-testid="photo-frame"]')
    expect(frame).not.toBeNull()
    vi.spyOn(frame as Element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 200,
      bottom: 400,
      width: 200,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    frame?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100, clientY: 200 }))
    await nextTick()

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    const last = emitted?.at(-1)?.[0] as RouteHold[]
    expect(last).toHaveLength(2)
    expect(last[1]).toMatchObject({ number: 2, x: 0.5, y: 0.5 })
  })
})
