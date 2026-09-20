import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PhotoCropDialog from '../../components/PhotoCropDialog.vue'
import type { PickedPhoto } from '../../lib/photo-crop'

const resize = vi.hoisted(() => ({ resizeToJpeg: vi.fn() }))
vi.mock('../../lib/photo-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/photo-resize')>()),
  resizeToJpeg: resize.resizeToJpeg,
}))

const { default: RoutePhotoPicker } = await import('./RoutePhotoPicker.vue')

const mounted: VueWrapper[] = []
const file = new File([new Uint8Array([1, 2, 3])], 'mur.jpg', { type: 'image/jpeg' })
const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }

/** Monte le sélecteur comme un parent : `v-model` branché sur un état local. */
function mountPicker(initial: PickedPhoto | null = null) {
  const wrapper = mount(RoutePhotoPicker, {
    attachTo: document.body,
    props: {
      modelValue: initial,
      label: 'Choisir une photo',
      'onUpdate:modelValue': (value: PickedPhoto | null) => wrapper.setProps({ modelValue: value }),
    },
  })
  mounted.push(wrapper)
  return wrapper
}

async function chooseFile(wrapper: VueWrapper) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

let created = 0
let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>
beforeEach(() => {
  created = 0
  resize.resizeToJpeg.mockReset()
  resize.resizeToJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
  URL.createObjectURL = vi.fn(() => `blob:picker-${(created += 1)}`)
  revokeObjectURL = vi.fn<(url: string) => void>()
  URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('RoutePhotoPicker', () => {
  it('n’affiche ni aperçu ni bouton de recadrage tant qu’aucune photo n’est choisie', () => {
    const wrapper = mountPicker()

    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Recadrer la photo')).toBeUndefined()
  })

  it('montre un aperçu produit par le même ré-encodage que l’envoi, recadrage compris', async () => {
    const wrapper = mountPicker()

    await chooseFile(wrapper)

    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(true)
    expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(
      file,
      expect.objectContaining({ crop: null, maxSide: 640 }),
    )

    wrapper.findComponent(PhotoCropDialog).vm.$emit('apply', crop)
    await flushPromises()

    expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(file, expect.objectContaining({ crop }))
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ file, crop }])
  })

  it('ouvre le recadrage sur la photo d’origine, pas sur l’aperçu réduit', async () => {
    const wrapper = mountPicker()
    await chooseFile(wrapper)

    await buttonNamed(wrapper, 'Recadrer la photo')?.trigger('click')

    const dialog = wrapper.findComponent(PhotoCropDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('crop')).toBeNull()
    // Deux URL distinctes : l'original (recadrage) et l'aperçu (image réduite).
    expect(dialog.props('imageUrl')).not.toBe(wrapper.get('img').attributes('src'))
  })

  it('propose de modifier ou de retirer un recadrage déjà appliqué', async () => {
    const wrapper = mountPicker({ file, crop })
    await flushPromises()

    expect(wrapper.text()).toContain("La photo sera recadrée avant l'envoi.")
    expect(buttonNamed(wrapper, 'Modifier le recadrage')).toBeDefined()

    await buttonNamed(wrapper, 'Retirer le recadrage')?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ file, crop: null }])
    expect(buttonNamed(wrapper, 'Recadrer la photo')).toBeDefined()
  })

  it('refuse un fichier illisible dès le choix et ne le retient pas', async () => {
    const { PhotoUnreadableError } = await import('../../lib/photo-resize')
    resize.resizeToJpeg.mockRejectedValue(new PhotoUnreadableError())
    const wrapper = mountPicker()

    await chooseFile(wrapper)

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'pas une photo que le navigateur sait lire',
    )
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([null])
    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(false)
  })

  it('remonte le champ fichier quand la sélection est vidée, pour pouvoir re-choisir le même fichier', async () => {
    const wrapper = mountPicker({ file, crop: null })
    await flushPromises()
    const before = wrapper.get('input[type="file"]').element

    await wrapper.setProps({ modelValue: null })

    expect(wrapper.get('input[type="file"]').element).not.toBe(before)
  })

  it('libère les URL d’aperçu quand l’écran est quitté', async () => {
    const wrapper = mountPicker()
    await chooseFile(wrapper)

    wrapper.unmount()

    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
