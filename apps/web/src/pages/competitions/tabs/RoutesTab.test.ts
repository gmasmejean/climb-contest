import type { CreateRouteInput } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../api/client'
import type { RouteWithCategories } from '../../../api/competitions'
import { stubDesktop } from '../../../test-utils/media-query'

const api = vi.hoisted(() => ({
  routes: { list: vi.fn(), create: vi.fn(), update: vi.fn(), reorder: vi.fn() },
  categories: { list: vi.fn() },
  photo: {
    upload: vi.fn(),
    saveHolds: vi.fn(),
    downloadSheets: vi.fn(),
    fetchImage: vi.fn(),
  },
}))
vi.mock('../../../api/competitions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/competitions')>()),
  routesApi: api.routes,
  categoriesApi: api.categories,
  routePhotoApi: api.photo,
}))

const resize = vi.hoisted(() => ({ resizeToJpeg: vi.fn() }))
vi.mock('../../../lib/photo-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/photo-resize')>()),
  resizeToJpeg: resize.resizeToJpeg,
}))

const { default: RoutesTab } = await import('./RoutesTab.vue')

const mounted: VueWrapper[] = []
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }

function aRoute(overrides: Partial<RouteWithCategories> = {}): RouteWithCategories {
  return {
    id: 'route-1',
    competitionId: 'comp-1',
    number: 1,
    name: null,
    holdCount: 12,
    sector: null,
    color: null,
    videoUrl: null,
    videoAssetId: null,
    photoAssetId: null,
    photoHolds: null,
    notes: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    categoryIds: [],
    ...overrides,
  }
}

async function mountTab() {
  const wrapper = mount(RoutesTab, {
    attachTo: document.body,
    props: { competitionId: 'comp-1' },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

async function fillAndChoosePhoto(wrapper: VueWrapper) {
  const [number, holdCount] = wrapper.findAll<HTMLInputElement>('input[type="number"]')
  await number?.setValue('1')
  await holdCount?.setValue('12')
  const input = wrapper.get('input[type="file"]')
  const file = new File([new Uint8Array([1, 2, 3])], 'mur.jpg', { type: 'image/jpeg' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
  return file
}

const buttonNamed = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('button').find((b) => b.text() === label)

async function submit(wrapper: VueWrapper) {
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset()
  resize.resizeToJpeg.mockReset()
  resize.resizeToJpeg.mockResolvedValue(jpeg)
  api.routes.list.mockResolvedValue([])
  api.categories.list.mockResolvedValue([])
  api.photo.fetchImage.mockResolvedValue(jpeg)
  URL.createObjectURL = vi.fn(() => 'blob:routes-tab')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

describe('RoutesTab — photo à la création de la voie', () => {
  it('propose la photo dès la création, marquée facultative', async () => {
    const wrapper = await mountTab()

    expect(wrapper.text()).toContain('Photo de la voie (optionnelle)')
  })

  it('crée la voie puis envoie la photo recadrée sur la voie créée', async () => {
    api.routes.create.mockResolvedValue(aRoute({ id: 'route-9' }))
    api.photo.upload.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    const file = await fillAndChoosePhoto(wrapper)
    wrapper.findComponent({ name: 'PhotoCropDialog' }).vm.$emit('apply', crop)
    await flushPromises()

    await submit(wrapper)

    expect(resize.resizeToJpeg).toHaveBeenLastCalledWith(file, { crop })
    expect(api.routes.create).toHaveBeenCalledTimes(1)
    const payload = api.routes.create.mock.calls[0]?.[1] as CreateRouteInput
    expect(payload).toMatchObject({ number: 1, holdCount: 12 })
    expect(api.photo.upload).toHaveBeenCalledWith('comp-1', 'route-9', jpeg)
    // L'ordre compte : la photo ne peut partir qu'une fois la voie créée.
    expect(api.routes.create.mock.invocationCallOrder[0]).toBeLessThan(
      api.photo.upload.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('vide le formulaire, photo comprise, une fois la voie et sa photo enregistrées', async () => {
    api.routes.create.mockResolvedValue(aRoute())
    api.photo.upload.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)

    await submit(wrapper)

    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(false)
    expect(wrapper.get<HTMLInputElement>('input[type="number"]').element.value).toBe('')
  })

  it('sans photo, crée la voie comme avant et n’envoie rien', async () => {
    api.routes.create.mockResolvedValue(aRoute())
    const wrapper = await mountTab()
    const [number, holdCount] = wrapper.findAll<HTMLInputElement>('input[type="number"]')
    await number?.setValue('1')
    await holdCount?.setValue('12')

    await submit(wrapper)

    expect(api.routes.create).toHaveBeenCalledTimes(1)
    expect(api.photo.upload).not.toHaveBeenCalled()
    expect(resize.resizeToJpeg).not.toHaveBeenCalled()
  })

  it('si l’envoi de la photo échoue, garde tout et reprend sans créer de doublon', async () => {
    const created = aRoute({ id: 'route-9' })
    api.routes.create.mockResolvedValue(created)
    api.routes.update.mockResolvedValue(created)
    api.photo.upload
      .mockRejectedValueOnce(new ApiError(503, 'Service indisponible', 'Réseau saturé.'))
      .mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)

    await submit(wrapper)

    const alert = wrapper.get('[role="alert"]').text()
    expect(alert).toContain('La voie a été créée, mais sa photo n’a pas pu être envoyée')
    expect(alert).toContain('Réseau saturé.')
    expect(alert).toContain('ne sera pas créée en double')
    // Rien n'est perdu : la photo reste choisie, on est toujours en création.
    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Ajouter une voie')

    await submit(wrapper)

    // Deuxième essai : la voie est mise à jour (pas recréée) et la photo part.
    expect(api.routes.create).toHaveBeenCalledTimes(1)
    expect(api.routes.update).toHaveBeenCalledWith('comp-1', 'route-9', expect.anything())
    expect(api.photo.upload).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(false)
  })

  it('si le fichier est illisible, ne crée aucune voie', async () => {
    const { PhotoUnreadableError } = await import('../../../lib/photo-resize')
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)
    // L'aperçu a réussi ; c'est le ré-encodage final qui échoue.
    resize.resizeToJpeg.mockRejectedValue(new PhotoUnreadableError())

    await submit(wrapper)

    expect(api.routes.create).not.toHaveBeenCalled()
    expect(api.photo.upload).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'pas une photo que le navigateur sait lire',
    )
  })

  it('n’affiche plus le sélecteur de création quand on modifie une voie (l’éditeur a le sien)', async () => {
    api.routes.list.mockResolvedValue([aRoute()])
    const wrapper = await mountTab()

    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Photo de la voie (optionnelle)')
    expect(wrapper.find('[data-testid="route-photo-editor"]').exists()).toBe(true)
  })
})

describe('RoutesTab — annotation à la création : le nombre de prises suit la photo', () => {
  async function annotate(wrapper: VueWrapper, taps: Array<[number, number]>) {
    await buttonNamed(wrapper, 'Continuer sans recadrer')?.trigger('click')
    await flushPromises()
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
    for (const [x, y] of taps) await frame.trigger('click', { clientX: x, clientY: y })
  }
  const holdCountField = (wrapper: VueWrapper) =>
    wrapper.find('[data-testid="hold-count-from-photo"]')

  it('remplace le nombre saisi par le nombre de prises placées, et le dit', async () => {
    api.routes.create.mockResolvedValue(aRoute({ id: 'route-9' }))
    api.photo.upload.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    api.photo.saveHolds.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper) // saisit 12 prises

    await annotate(wrapper, [
      [100, 350],
      [80, 200],
      [120, 60],
    ])

    expect(holdCountField(wrapper).text()).toContain('3')
    expect(holdCountField(wrapper).text()).toContain('Remplace les 12 saisies')
    // Le champ de saisie est remplacé : une seule source de vérité.
    expect(wrapper.findAll('label').some((l) => l.text().startsWith('Nombre de prises'))).toBe(
      false,
    )

    await submit(wrapper)

    const payload = api.routes.create.mock.calls[0]?.[1] as CreateRouteInput
    expect(payload.holdCount).toBe(3)
    expect(api.photo.saveHolds).toHaveBeenCalledTimes(1)
    const [, routeId, saved] = api.photo.saveHolds.mock.calls[0] ?? []
    expect(routeId).toBe('route-9')
    expect((saved as Array<{ number: number }>).map((hold) => hold.number)).toEqual([1, 2, 3])
    // Les prises partent APRÈS la photo, sur laquelle elles sont placées.
    expect(api.photo.upload.mock.invocationCallOrder[0]).toBeLessThan(
      api.photo.saveHolds.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('rend le champ quand toutes les prises sont retirées, avec la valeur saisie', async () => {
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)
    await annotate(wrapper, [[100, 350]])
    expect(holdCountField(wrapper).exists()).toBe(true)

    await wrapper.get('[data-testid="hold-handle"]').trigger('keydown', { key: 'Delete' })

    expect(holdCountField(wrapper).exists()).toBe(false)
    const [, holdCount] = wrapper.findAll<HTMLInputElement>('input[type="number"]')
    expect(holdCount?.element.value).toBe('12')
  })

  it('compte jusqu’au plus haut numéro quand la numérotation a un trou', async () => {
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)
    await annotate(wrapper, [[100, 350]])

    wrapper.findComponent({ name: 'NewRoutePhoto' }).vm.$emit('update:holds', [
      { number: 1, x: 0.5, y: 0.9 },
      { number: 4, x: 0.5, y: 0.2 },
    ])
    await flushPromises()

    expect(holdCountField(wrapper).text()).toContain('4')
  })

  it('sans prise placée, garde le nombre saisi et n’enregistre aucune prise', async () => {
    api.routes.create.mockResolvedValue(aRoute({ id: 'route-9' }))
    api.photo.upload.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)

    await submit(wrapper)

    const payload = api.routes.create.mock.calls[0]?.[1] as CreateRouteInput
    expect(payload.holdCount).toBe(12)
    expect(api.photo.saveHolds).not.toHaveBeenCalled()
  })

  it('si l’enregistrement des prises échoue, ne renvoie pas la photo au second essai', async () => {
    const created = aRoute({ id: 'route-9' })
    api.routes.create.mockResolvedValue(created)
    api.routes.update.mockResolvedValue(created)
    api.photo.upload.mockResolvedValue({ assetId: 'asset-1', holds: [] })
    api.photo.saveHolds
      .mockRejectedValueOnce(new ApiError(503, 'Service indisponible', 'Réseau saturé.'))
      .mockResolvedValue({ assetId: 'asset-1', holds: [] })
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)
    await annotate(wrapper, [
      [100, 350],
      [80, 200],
    ])

    await submit(wrapper)

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'ses prises n’ont pas pu être enregistrées',
    )
    // Les prises placées sont toujours là : rien à replacer.
    expect(holdCountField(wrapper).text()).toContain('2')

    await submit(wrapper)

    expect(api.routes.create).toHaveBeenCalledTimes(1)
    expect(api.photo.upload).toHaveBeenCalledTimes(1)
    expect(api.photo.saveHolds).toHaveBeenCalledTimes(2)
    // La mise à jour reprend le nombre de prises annoncé par l'annotation.
    const update = api.routes.update.mock.calls[0]?.[2] as CreateRouteInput
    expect(update.holdCount).toBe(2)
  })

  it('« Annuler » abandonne la reprise : le formulaire redevient vierge', async () => {
    api.routes.create.mockResolvedValue(aRoute({ id: 'route-9' }))
    api.photo.upload.mockRejectedValue(new ApiError(503, 'Service indisponible', 'Réseau saturé.'))
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)
    await submit(wrapper)

    await buttonNamed(wrapper, 'Annuler')?.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="photo-preview"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(buttonNamed(wrapper, 'Annuler')).toBeUndefined()
  })
})

describe('RoutesTab — tableau des grands écrans (Lot 18)', () => {
  const three = [
    aRoute({ id: 'r1', number: 1, name: 'Dalle', sector: 'Gauche', color: '#ff0000' }),
    aRoute({ id: 'r2', number: 2, name: 'Dièdre' }),
    aRoute({ id: 'r3', number: 3, name: 'Toit' }),
  ]

  it('montre en colonnes le secteur et la couleur, invisibles en cartes', async () => {
    api.routes.list.mockResolvedValue(three)
    const cards = await mountTab()
    expect(cards.text()).not.toContain('Gauche')

    stubDesktop(true)
    api.routes.list.mockResolvedValue(three)
    const table = await mountTab()
    expect(table.find('table').exists()).toBe(true)
    expect(table.text()).toContain('Gauche')
    expect(table.text()).toContain('#ff0000')
  })

  it('n’offre aucun tri : l’ordre de la compétition fait foi', async () => {
    stubDesktop(true)
    api.routes.list.mockResolvedValue(three)
    const wrapper = await mountTab()
    expect(wrapper.findAll('thead button')).toHaveLength(0)
    expect(wrapper.findAll('thead th[aria-sort]')).toHaveLength(0)
  })

  /**
   * `route-photo`, `route-photo-create-crop` et `route-video` prennent le
   * PREMIER bouton nommé « Modifier » et comptent sur l'ordre de la compétition.
   */
  it('garde un bouton « Modifier » par ligne, dans l’ordre reçu', async () => {
    stubDesktop(true)
    api.routes.list.mockResolvedValue(three)
    const wrapper = await mountTab()
    const editors = wrapper.findAll('button').filter((button) => button.text() === 'Modifier')
    expect(editors).toHaveLength(3)
    await editors[0]?.trigger('click')
    await flushPromises()
    expect(wrapper.findAll<HTMLInputElement>('input[type="number"]')[0]?.element.value).toBe('1')
  })

  it('remonte une voie depuis le tableau', async () => {
    stubDesktop(true)
    api.routes.list.mockResolvedValue(three)
    api.routes.reorder.mockResolvedValue(undefined)
    const wrapper = await mountTab()
    const up = wrapper.findAll('button[aria-label="Monter"]')
    expect(up[0]?.attributes('disabled')).toBeDefined()
    await up[1]?.trigger('click')
    await flushPromises()
    expect(api.routes.reorder).toHaveBeenCalledWith('comp-1', ['r2', 'r1', 'r3'])
  })
})

describe('RoutesTab — la voie modifiée quitte la liste', () => {
  it('revient en création plutôt que d’enregistrer sur un identifiant mort', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    api.routes.list.mockResolvedValue([aRoute({ id: 'route-1', number: 7 })])
    const wrapper = mount(RoutesTab, {
      attachTo: document.body,
      props: { competitionId: 'comp-1' },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    })
    mounted.push(wrapper)
    await flushPromises()

    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Modifier la voie')

    // La voie disparaît de la liste sous les pieds de l'éditeur.
    api.routes.list.mockResolvedValue([])
    await queryClient.invalidateQueries({ queryKey: ['competitions', 'comp-1', 'routes'] })
    await flushPromises()

    expect(wrapper.text()).toContain('Ajouter une voie')
    await submit(wrapper)
    expect(api.routes.update).not.toHaveBeenCalled()
  })

  it('ne referme pas la voie ouverte pendant que la liste est encore en vol', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    api.routes.list.mockResolvedValue([aRoute({ id: 'route-1', number: 7 })])
    const wrapper = mount(RoutesTab, {
      attachTo: document.body,
      props: { competitionId: 'comp-1' },
      global: { plugins: [[VueQueryPlugin, { queryClient }]] },
    })
    mounted.push(wrapper)
    await flushPromises()

    await buttonNamed(wrapper, 'Modifier')?.trigger('click')
    await flushPromises()

    // Une requête en vol ne doit pas être lue comme « la voie a disparu ».
    let resolveList: (routes: RouteWithCategories[]) => void = () => {}
    api.routes.list.mockReturnValue(
      new Promise<RouteWithCategories[]>((resolve) => (resolveList = resolve)),
    )
    void queryClient.invalidateQueries({ queryKey: ['competitions', 'comp-1', 'routes'] })
    await flushPromises()
    expect(wrapper.text()).toContain('Modifier la voie')

    resolveList([aRoute({ id: 'route-1', number: 7 })])
    await flushPromises()
    expect(wrapper.text()).toContain('Modifier la voie')
  })
})
