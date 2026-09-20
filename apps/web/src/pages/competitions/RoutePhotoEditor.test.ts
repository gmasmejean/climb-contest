import type { RouteHold } from '@climbcontest/contracts'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../api/client'
import PhotoCropDialog from '../../components/PhotoCropDialog.vue'

const api = vi.hoisted(() => ({
  fetchImage: vi.fn(),
  upload: vi.fn(),
  saveHolds: vi.fn(),
  remove: vi.fn(),
  downloadSheets: vi.fn(),
}))
vi.mock('../../api/competitions', () => ({ routePhotoApi: api }))

const resize = vi.hoisted(() => ({ resizeToJpeg: vi.fn() }))
vi.mock('../../lib/photo-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/photo-resize')>()),
  resizeToJpeg: resize.resizeToJpeg,
}))

const { default: RoutePhotoEditor } = await import('./RoutePhotoEditor.vue')

const saved: RouteHold[] = [
  { number: 1, x: 0.5, y: 0.9 },
  { number: 2, x: 0.4, y: 0.5 },
]

const mounted: VueWrapper[] = []

async function mountEditor(
  overrides: Partial<{
    holdCount: number
    photoAssetId: string | null
    savedHolds: RouteHold[]
  }> = {},
) {
  const wrapper = mount(RoutePhotoEditor, {
    attachTo: document.body,
    props: {
      competitionId: 'comp-1',
      routeId: 'route-1',
      routeNumber: 3,
      holdCount: 5,
      photoAssetId: 'asset-1',
      savedHolds: saved,
      ...overrides,
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  // jsdom ne fait aucune mise en page : on donne un cadre de 200 × 400 px à la photo.
  const frameWrapper = wrapper.find('[data-testid="photo-frame"]')
  if (!frameWrapper.exists()) return wrapper
  vi.spyOn(frameWrapper.element, 'getBoundingClientRect').mockReturnValue({
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
  return wrapper
}

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((button) => button.text() === label)
const markers = (wrapper: VueWrapper) =>
  wrapper.findAll('[data-testid="hold-marker"]').map((marker) => marker.attributes('data-number'))
const dialog = () => document.body.querySelector('[role="dialog"]')
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label)

async function tapPhoto(wrapper: VueWrapper, x: number, y: number) {
  await wrapper.find('[data-testid="photo-frame"]').trigger('click', { clientX: x, clientY: y })
}

describe('RoutePhotoEditor', () => {
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset()
    resize.resizeToJpeg.mockReset()
    api.fetchImage.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
    api.saveHolds.mockResolvedValue({ assetId: 'asset-1', holds: saved })
    URL.createObjectURL = vi.fn(() => 'blob:editor-photo')
    revokeObjectURL = vi.fn<(url: string) => void>()
    URL.revokeObjectURL = revokeObjectURL
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('charge la photo avec le jeton et affiche les prises enregistrées', async () => {
    const wrapper = await mountEditor()

    expect(api.fetchImage).toHaveBeenCalledWith('comp-1', 'route-1')
    expect(wrapper.find('img').attributes('src')).toBe('blob:editor-photo')
    expect(markers(wrapper)).toEqual(['1', '2'])
    expect(wrapper.get('[data-testid="hold-counter"]').text()).toContain('2 prises placées sur 5')
  })

  it('sans photo, invite à en choisir une et n’affiche aucun cadre', async () => {
    const wrapper = await mountEditor({ photoAssetId: null, savedHolds: [] })

    expect(wrapper.text()).toContain('Aucune photo')
    expect(wrapper.find('[data-testid="photo-frame"]').exists()).toBe(false)
    expect(api.fetchImage).not.toHaveBeenCalled()
  })

  it('toucher la photo place une prise au prochain numéro libre, à l’endroit touché', async () => {
    const wrapper = await mountEditor()

    await tapPhoto(wrapper, 100, 100)

    expect(markers(wrapper)).toEqual(['1', '2', '3'])
    const added = wrapper.find('[data-number="3"]').attributes('style')
    expect(added).toContain('left: 50%')
    expect(added).toContain('top: 25%')
    // La prise posée est sélectionnée, et l'annotation devient « à enregistrer ».
    expect(wrapper.text()).toContain('Prise 3 sélectionnée')
    expect(wrapper.text()).toContain('Modifications non enregistrées')
  })

  it('refuse de placer plus de prises que le nombre de prises de la voie, et dit quoi faire', async () => {
    const wrapper = await mountEditor({ holdCount: 2 })

    await tapPhoto(wrapper, 100, 100)

    expect(markers(wrapper)).toEqual(['1', '2'])
    const alert = wrapper.get('[role="alert"]').text()
    expect(alert).toContain('Les 2 prises de la voie sont déjà placées')
    expect(alert).toContain('augmentez d')
  })

  it('enregistre les prises triées par numéro', async () => {
    const wrapper = await mountEditor()
    await tapPhoto(wrapper, 20, 40)

    await buttonNamed(wrapper, 'Enregistrer les prises')?.trigger('click')
    await flushPromises()

    expect(api.saveHolds).toHaveBeenCalledWith('comp-1', 'route-1', [
      ...saved,
      { number: 3, x: 0.1, y: 0.1 },
    ])
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('« Enregistrer » est inactif tant que rien n’a changé', async () => {
    const wrapper = await mountEditor()

    expect(buttonNamed(wrapper, 'Enregistrer les prises')?.attributes('disabled')).toBeDefined()
  })

  it('montre le message du serveur quand l’enregistrement est refusé', async () => {
    api.saveHolds.mockRejectedValue(
      new ApiError(
        409,
        'Modification impossible',
        'Un passage existe déjà sur cette voie : sa photo et ses prises ne peuvent plus changer (ADR-066).',
      ),
    )
    const wrapper = await mountEditor()
    await tapPhoto(wrapper, 20, 40)

    await buttonNamed(wrapper, 'Enregistrer les prises')?.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Un passage existe déjà')
    // Rien n'est perdu : les modifications restent à l'écran.
    expect(markers(wrapper)).toEqual(['1', '2', '3'])
  })

  it('« Annuler les modifications » revient à ce que le serveur a', async () => {
    const wrapper = await mountEditor()
    await tapPhoto(wrapper, 20, 40)
    expect(markers(wrapper)).toHaveLength(3)

    await buttonNamed(wrapper, 'Annuler les modifications')?.trigger('click')

    expect(markers(wrapper)).toEqual(['1', '2'])
    expect(wrapper.text()).not.toContain('Modifications non enregistrées')
  })

  it('une relecture des voies sans changement ne perd pas les modifications en cours', async () => {
    const wrapper = await mountEditor()
    await tapPhoto(wrapper, 20, 40)

    // Retour sur l'onglet : les voies sont relues, mêmes prises enregistrées.
    await wrapper.setProps({ savedHolds: saved.map((hold) => ({ ...hold })) })

    expect(markers(wrapper)).toEqual(['1', '2', '3'])
  })

  it('supprime la prise sélectionnée', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="hold-handle"]').trigger('click')

    await buttonNamed(wrapper, 'Supprimer cette prise')?.trigger('click')

    expect(markers(wrapper)).toEqual(['2'])
    expect(wrapper.text()).toContain('a un trou') // le numéro 1 n'est plus utilisé
  })

  it('change le numéro d’une prise, et refuse un numéro déjà pris', async () => {
    const wrapper = await mountEditor()
    await wrapper.findAll('[data-testid="hold-handle"]')[1]?.trigger('click') // prise 2

    const input = wrapper.get('input[type="number"]')
    await input.setValue('1')
    await buttonNamed(wrapper, 'Changer le numéro')?.trigger('click')
    expect(wrapper.text()).toContain('Le numéro 1 est déjà utilisé')
    expect(markers(wrapper)).toEqual(['1', '2'])

    await input.setValue('4')
    await buttonNamed(wrapper, 'Changer le numéro')?.trigger('click')
    expect(markers(wrapper)).toEqual(['1', '4'])
  })

  it('« Renuméroter de bas en haut » classe les prises d’après leur hauteur', async () => {
    const wrapper = await mountEditor({
      savedHolds: [
        { number: 1, x: 0.5, y: 0.1 }, // en haut de la photo
        { number: 2, x: 0.5, y: 0.9 }, // en bas
      ],
    })

    await buttonNamed(wrapper, 'Renuméroter de bas en haut')?.trigger('click')

    const bottom = wrapper.find('[data-number="1"]').attributes('style')
    expect(bottom).toContain('top: 90%')
  })

  it('propose d’utiliser le nombre de prises placées quand il diffère et que la numérotation est continue', async () => {
    const wrapper = await mountEditor({ holdCount: 5 })

    await buttonNamed(wrapper, 'Utiliser 2 comme nombre de prises')?.trigger('click')

    expect(wrapper.emitted('use-hold-count')).toEqual([[2]])
  })

  it('ne propose pas ce nombre quand la numérotation a un trou ou que rien n’est enregistré', async () => {
    const withGap = await mountEditor({
      savedHolds: [
        { number: 1, x: 0.1, y: 0.1 },
        { number: 3, x: 0.2, y: 0.2 },
      ],
    })
    expect(buttonNamed(withGap, 'Utiliser 2 comme nombre de prises')).toBeUndefined()

    const unsaved = await mountEditor({ holdCount: 5 })
    await tapPhoto(unsaved, 10, 10)
    expect(buttonNamed(unsaved, 'Utiliser 3 comme nombre de prises')).toBeUndefined()
  })

  it('n’imprime la fiche qu’une fois les prises enregistrées', async () => {
    const wrapper = await mountEditor()
    const print = () => buttonNamed(wrapper, 'Imprimer la fiche de cette voie')
    expect(print()?.attributes('disabled')).toBeUndefined()

    await tapPhoto(wrapper, 20, 40)
    expect(print()?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Enregistrez d')
  })

  it('imprime la fiche de cette voie seulement', async () => {
    api.downloadSheets.mockResolvedValue(undefined)
    const wrapper = await mountEditor()

    await buttonNamed(wrapper, 'Imprimer la fiche de cette voie')?.trigger('click')
    await flushPromises()

    expect(api.downloadSheets).toHaveBeenCalledWith('comp-1', 'route-1')
  })

  describe('envoi de la photo', () => {
    async function chooseFile(wrapper: VueWrapper) {
      const input = wrapper.get('input[type="file"]')
      const file = new File([new Uint8Array([1, 2, 3])], 'voie.png', { type: 'image/png' })
      Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
      await input.trigger('change')
      return file
    }

    it('ré-encode la photo puis l’envoie', async () => {
      const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
      resize.resizeToJpeg.mockResolvedValue(jpeg)
      api.upload.mockResolvedValue({ assetId: 'asset-2', holds: [] })
      const wrapper = await mountEditor({ photoAssetId: null, savedHolds: [] })
      const file = await chooseFile(wrapper)

      await buttonNamed(wrapper, 'Envoyer la photo')?.trigger('click')
      await flushPromises()

      // Le dernier appel est l'envoi (le premier produit l'aperçu du sélecteur).
      expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(file, { crop: null })
      expect(api.upload).toHaveBeenCalledWith('comp-1', 'route-1', jpeg)
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

    it('refuse dès le choix, en français, un fichier qui n’est pas une photo lisible', async () => {
      const { PhotoUnreadableError } = await import('../../lib/photo-resize')
      resize.resizeToJpeg.mockRejectedValue(new PhotoUnreadableError())
      const wrapper = await mountEditor({ photoAssetId: null, savedHolds: [] })
      await chooseFile(wrapper)
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toContain(
        'pas une photo que le navigateur sait lire',
      )
      // Rien à envoyer : le fichier refusé n'est pas retenu.
      expect(buttonNamed(wrapper, 'Envoyer la photo')?.attributes('disabled')).toBeDefined()
      expect(api.upload).not.toHaveBeenCalled()
    })

    it('envoie la zone recadrée', async () => {
      const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
      resize.resizeToJpeg.mockResolvedValue(jpeg)
      api.upload.mockResolvedValue({ assetId: 'asset-2', holds: [] })
      const wrapper = await mountEditor({ photoAssetId: null, savedHolds: [] })
      const file = await chooseFile(wrapper)
      const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }

      wrapper.findComponent(PhotoCropDialog).vm.$emit('apply', crop)
      await flushPromises()
      await buttonNamed(wrapper, 'Envoyer la photo')?.trigger('click')
      await flushPromises()

      expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(file, { crop })
      expect(api.upload).toHaveBeenCalledWith('comp-1', 'route-1', jpeg)
    })

    it('demande confirmation avant de remplacer une photo qui porte des prises', async () => {
      resize.resizeToJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
      api.upload.mockResolvedValue({ assetId: 'asset-2', holds: [] })
      const wrapper = await mountEditor()
      await chooseFile(wrapper)

      await buttonNamed(wrapper, 'Envoyer la nouvelle photo')?.trigger('click')
      await flushPromises()
      expect(api.upload).not.toHaveBeenCalled()
      expect(dialog()?.textContent).toContain(
        "Les 2 prises placées sur l'ancienne photo seront effacées",
      )

      dialogButton("Garder l'ancienne")?.click()
      await flushPromises()
      expect(api.upload).not.toHaveBeenCalled()

      await buttonNamed(wrapper, 'Envoyer la nouvelle photo')?.trigger('click')
      dialogButton('Remplacer la photo')?.click()
      await flushPromises()
      expect(api.upload).toHaveBeenCalledTimes(1)
    })

    it('remplace sans confirmation quand aucune prise n’est enregistrée', async () => {
      resize.resizeToJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
      api.upload.mockResolvedValue({ assetId: 'asset-2', holds: [] })
      const wrapper = await mountEditor({ savedHolds: [] })
      await chooseFile(wrapper)

      await buttonNamed(wrapper, 'Envoyer la nouvelle photo')?.trigger('click')
      await flushPromises()

      expect(dialog()).toBeNull()
      expect(api.upload).toHaveBeenCalledTimes(1)
    })

    it('affiche le refus du serveur (voie déjà notée)', async () => {
      resize.resizeToJpeg.mockResolvedValue(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
      api.upload.mockRejectedValue(
        new ApiError(409, 'Modification impossible', 'Un passage existe déjà sur cette voie.'),
      )
      const wrapper = await mountEditor({ savedHolds: [] })
      await chooseFile(wrapper)

      await buttonNamed(wrapper, 'Envoyer la nouvelle photo')?.trigger('click')
      await flushPromises()

      expect(wrapper.get('[role="alert"]').text()).toContain('Un passage existe déjà')
    })
  })

  it('supprime la photo après confirmation', async () => {
    api.remove.mockResolvedValue(undefined)
    const wrapper = await mountEditor()

    await buttonNamed(wrapper, 'Supprimer la photo')?.trigger('click')
    expect(api.remove).not.toHaveBeenCalled()
    dialogButton('Supprimer la photo')?.click()
    await flushPromises()

    expect(api.remove).toHaveBeenCalledWith('comp-1', 'route-1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('signale une photo impossible à charger', async () => {
    api.fetchImage.mockRejectedValue(new ApiError(404, 'Photo introuvable'))
    const wrapper = await mountEditor()

    expect(wrapper.get('[role="alert"]').text()).toContain('Impossible de charger la photo')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('libère l’aperçu quand l’écran est quitté', async () => {
    const wrapper = await mountEditor()

    wrapper.unmount()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:editor-photo')
  })
})
