import type { RouteHold } from '@climbcontest/contracts'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PhotoCropDialog from '../../components/PhotoCropDialog.vue'
import type { PickedPhoto } from '../../lib/photo-crop'

const resize = vi.hoisted(() => ({ resizeToJpeg: vi.fn() }))
vi.mock('../../lib/photo-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/photo-resize')>()),
  resizeToJpeg: resize.resizeToJpeg,
}))

const { default: NewRoutePhoto } = await import('./NewRoutePhoto.vue')

const mounted: VueWrapper[] = []
const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }
const hold = (number: number): RouteHold => ({ number, x: 0.5, y: 0.5 })

/** Monte le composant comme un parent : les deux `v-model` branchés sur un état local. */
function mountIt(initial: { picked?: PickedPhoto | null; holds?: RouteHold[] } = {}) {
  const wrapper = mount(NewRoutePhoto, {
    attachTo: document.body,
    props: {
      routeNumber: 3,
      picked: initial.picked ?? null,
      holds: initial.holds ?? [],
      'onUpdate:picked': (value: PickedPhoto | null) => wrapper.setProps({ picked: value }),
      'onUpdate:holds': (value: RouteHold[]) => wrapper.setProps({ holds: value }),
    },
  })
  mounted.push(wrapper)
  return wrapper
}

async function chooseFile(wrapper: VueWrapper, name = 'mur.jpg') {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [file(name)], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)
const dialog = () => document.body.querySelector('[role="dialog"]')
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)
const annotator = (wrapper: VueWrapper) => wrapper.find('[data-testid="hold-annotator"]')

beforeEach(() => {
  resize.resizeToJpeg.mockReset()
  resize.resizeToJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
  let urls = 0
  URL.createObjectURL = vi.fn(() => `blob:new-route-${(urls += 1)}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('NewRoutePhoto — choisir, recadrer ou non, puis annoter', () => {
  it('commence par le seul choix du fichier', () => {
    const wrapper = mountIt()

    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="crop-step"]').exists()).toBe(false)
    expect(annotator(wrapper).exists()).toBe(false)
  })

  it('étape 2 : une fois la photo choisie, demande de la recadrer ou non — sans encore annoter', async () => {
    const wrapper = mountIt()

    await chooseFile(wrapper)

    expect(wrapper.get('[data-testid="crop-step"]').text()).toContain(
      'Souhaitez-vous recadrer la photo ?',
    )
    expect(buttonNamed(wrapper, 'Recadrer la photo')).toBeDefined()
    expect(buttonNamed(wrapper, 'Continuer sans recadrer')).toBeDefined()
    expect(annotator(wrapper).exists()).toBe(false)
  })

  it('« Continuer sans recadrer » passe à l’annotation, photo entière', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)

    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')

    expect(annotator(wrapper).exists()).toBe(true)
    expect(wrapper.find('[data-testid="crop-step"]').exists()).toBe(false)
    expect(wrapper.emitted('update:picked')?.at(-1)?.[0]).toMatchObject({ crop: null })
  })

  it('valider le recadrage passe à l’annotation, sur la photo recadrée', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)

    await buttonNamed(wrapper, 'Recadrer la photo')?.trigger('click')
    wrapper.findComponent(PhotoCropDialog).vm.$emit('apply', crop)
    await flushPromises()

    expect(annotator(wrapper).exists()).toBe(true)
    expect(wrapper.emitted('update:picked')?.at(-1)?.[0]).toMatchObject({ crop })
    // L'image annotée est celle que le recadrage produit (aperçu régénéré avec la zone).
    expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ crop }),
    )
    expect(wrapper.text()).toContain('La photo est recadrée.')
  })

  it('les prises se placent sans plafond : c’est leur nombre qui fixera celui de la voie', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)
    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')
    const frame = wrapper.get('[data-testid="photo-frame"]')
    vi.spyOn(frame.element, 'getBoundingClientRect').mockReturnValue({
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

    for (const y of [380, 300, 220, 140, 60]) {
      await frame.trigger('click', { clientX: 100, clientY: y })
    }

    expect(wrapper.get('[data-testid="hold-counter"]').text()).toBe('5 prises placées')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('revenir au recadrage sans prise placée ne demande rien', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)
    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')

    await buttonNamed(wrapper, 'Modifier le recadrage')?.trigger('click')

    expect(dialog()).toBeNull()
    expect(wrapper.find('[data-testid="crop-step"]').exists()).toBe(true)
  })

  it('revenir au recadrage avec des prises demande confirmation, puis les efface', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)
    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')
    wrapper
      .findComponent({ name: 'HoldAnnotator' })
      .vm.$emit('update:modelValue', [hold(1), hold(2)])
    await flushPromises()

    await buttonNamed(wrapper, 'Modifier le recadrage')?.trigger('click')

    expect(dialog()?.textContent).toContain('Les 2 prises placées seront effacées')
    dialogButton('Garder les prises')?.click()
    await flushPromises()
    expect(annotator(wrapper).exists()).toBe(true)
    expect(wrapper.emitted('update:holds')?.at(-1)?.[0]).toHaveLength(2)

    await buttonNamed(wrapper, 'Modifier le recadrage')?.trigger('click')
    dialogButton('Modifier le recadrage')?.click()
    await flushPromises()

    expect(wrapper.find('[data-testid="crop-step"]').exists()).toBe(true)
    expect(wrapper.emitted('update:holds')?.at(-1)?.[0]).toEqual([])
  })

  it('choisir un autre fichier reprend au début, sans les prises de l’ancienne photo', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper, 'premiere.jpg')
    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')
    wrapper.findComponent({ name: 'HoldAnnotator' }).vm.$emit('update:modelValue', [hold(1)])
    await flushPromises()

    await chooseFile(wrapper, 'seconde.jpg')

    expect(wrapper.find('[data-testid="crop-step"]').exists()).toBe(true)
    expect(annotator(wrapper).exists()).toBe(false)
    expect(wrapper.emitted('update:holds')?.at(-1)?.[0]).toEqual([])
  })

  it('un recadrage déjà choisi se garde ou se retire avant de continuer', async () => {
    const wrapper = mountIt()
    await chooseFile(wrapper)
    await buttonNamed(wrapper, 'Recadrer la photo')?.trigger('click')
    wrapper.findComponent(PhotoCropDialog).vm.$emit('apply', crop)
    await flushPromises()
    await buttonNamed(wrapper, 'Modifier le recadrage')?.trigger('click')

    expect(buttonNamed(wrapper, 'Continuer avec ce recadrage')).toBeDefined()

    await buttonNamed(wrapper, 'Retirer le recadrage')?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:picked')?.at(-1)?.[0]).toMatchObject({ crop: null })
    expect(buttonNamed(wrapper, 'Continuer sans recadrer')).toBeDefined()
  })
})
