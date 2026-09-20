import type { CreateRouteInput } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../api/client'
import type { RouteWithCategories } from '../../../api/competitions'

const api = vi.hoisted(() => ({
  routes: { list: vi.fn(), create: vi.fn(), update: vi.fn(), reorder: vi.fn() },
  categories: { list: vi.fn() },
  photo: { upload: vi.fn(), downloadSheets: vi.fn(), fetchImage: vi.fn() },
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

  it('si l’envoi de la photo échoue, dit que la voie est créée et ouvre la voie pour renvoyer', async () => {
    const created = aRoute({ id: 'route-9', number: 4, holdCount: 12 })
    api.routes.create.mockResolvedValue(created)
    api.routes.list.mockResolvedValueOnce([]).mockResolvedValue([created])
    api.photo.upload.mockRejectedValue(new ApiError(503, 'Service indisponible', 'Réseau saturé.'))
    const wrapper = await mountTab()
    await fillAndChoosePhoto(wrapper)

    await submit(wrapper)

    const alert = wrapper.get('[role="alert"]').text()
    expect(alert).toContain('La voie a été créée, mais sa photo n')
    expect(alert).toContain('Réseau saturé.')
    expect(alert).toContain('Choisissez-la de nouveau')
    // La voie est en modification : « Enregistrer » et non « Ajouter », pas de doublon possible.
    expect(wrapper.text()).toContain('Modifier la voie')
    expect(buttonNamed(wrapper, 'Ajouter')).toBeUndefined()
    expect(api.routes.create).toHaveBeenCalledTimes(1)
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
