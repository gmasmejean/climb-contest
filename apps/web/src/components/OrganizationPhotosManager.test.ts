import type { OrganizationPhoto } from '@climbcontest/contracts'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api/client'
import { organizationPhotosApi } from '../api/organization'
import { PhotoUnreadableError, resizeToJpeg } from '../lib/photo-resize'
import OrganizationPhotosManager from './OrganizationPhotosManager.vue'

vi.mock('../api/organization', () => ({
  organizationPhotosApi: {
    list: vi.fn(),
    upload: vi.fn(),
    update: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    fetchImage: vi.fn(),
  },
}))

vi.mock('../lib/photo-resize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo-resize')>()),
  resizeToJpeg: vi.fn(),
}))

const api = vi.mocked(organizationPhotosApi)

/** Un serveur en mémoire : l'ordre, la limite et la suppression logique d'ADR-090. */
let server: { photo: OrganizationPhoto; deleted: boolean }[]
let nextId: number
const active = () => server.filter((row) => !row.deleted).map((row) => row.photo)

let wrapper: VueWrapper

beforeEach(() => {
  server = [
    { photo: { id: 'p1', altText: 'Le mur de bloc' }, deleted: false },
    { photo: { id: 'p2', altText: null }, deleted: false },
  ]
  nextId = 3
  api.list.mockImplementation(() => Promise.resolve(active()))
  api.fetchImage.mockResolvedValue(new Blob(['jpeg']))
  api.upload.mockImplementation(() => {
    if (active().length >= 6) return Promise.reject(new ApiError(409, 'Six photos au plus'))
    const photo = { id: `p${nextId++}`, altText: null }
    server.push({ photo, deleted: false })
    return Promise.resolve(photo)
  })
  api.update.mockImplementation((id, input) => {
    const row = server.find((r) => r.photo.id === id)
    if (!row) return Promise.reject(new ApiError(404, 'Photo introuvable'))
    row.photo = { id, altText: input.altText }
    return Promise.resolve(row.photo)
  })
  api.reorder.mockImplementation((ids) => {
    server.sort((a, b) => ids.indexOf(a.photo.id) - ids.indexOf(b.photo.id))
    return Promise.resolve(active())
  })
  api.remove.mockImplementation((id) => {
    const row = server.find((r) => r.photo.id === id)
    if (row) row.deleted = true
    return Promise.resolve()
  })
  api.restore.mockImplementation((id) => {
    const row = server.find((r) => r.photo.id === id)
    if (!row) return Promise.reject(new ApiError(404, 'Photo introuvable'))
    row.deleted = false
    return Promise.resolve(row.photo)
  })
  vi.mocked(resizeToJpeg).mockImplementation((file) =>
    Promise.resolve(new Blob([file], { type: 'image/jpeg' })),
  )
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:photo', revokeObjectURL: () => {} }),
  )
})

afterEach(() => {
  wrapper.unmount()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

async function open(): Promise<void> {
  wrapper = mount(OrganizationPhotosManager, {
    props: { organizationName: 'Club Roc' },
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
  await flushPromises()
}

const items = () => wrapper.findAll('[data-testid="managed-photo"]')
const button = (label: string) => {
  const found = wrapper
    .findAll('button')
    .find((b) => (b.attributes('aria-label') ?? b.text()) === label)
  if (!found) throw new Error(`bouton introuvable : ${label}`)
  return found
}

async function choose(files: File[]): Promise<void> {
  const input = wrapper.get('[data-testid="photo-input"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('OrganizationPhotosManager (ADR-090)', () => {
  it('liste les photos dans l’ordre, avec leur description et l’avertissement', async () => {
    await open()
    expect(items()).toHaveLength(2)
    expect(items()[0]?.text()).toContain('Photo 1 sur 2')
    expect(items()[0]?.get('img').attributes('alt')).toBe('Le mur de bloc')
    expect(items()[1]?.get('img').attributes('alt')).toBe('Photo 2 sur 2 de Club Roc')
    expect(wrapper.text()).toContain(
      'Ne publiez une photo où l’on reconnaît quelqu’un qu’avec son accord.',
    )
    expect(button('Avancer la photo 1').attributes('disabled')).toBeDefined()
    expect(button('Reculer la photo 2').attributes('disabled')).toBeDefined()
  })

  it('ajoute plusieurs photos ré-encodées, sans dépasser six', async () => {
    await open()
    await choose([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg'), jpeg('d.jpg'), jpeg('e.jpg')])
    expect(resizeToJpeg).toHaveBeenCalledTimes(4)
    expect(api.upload).toHaveBeenCalledTimes(4)
    expect(items()).toHaveLength(6)
    expect(wrapper.text()).toContain('1 photo n’a pas été ajoutée : la fiche en compte 6 au plus.')
    expect(wrapper.find('[data-testid="photo-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('La fiche a 6 photos : supprimez-en une pour en ajouter.')
  })

  it('un fichier illisible est signalé par son nom, les autres sont envoyés', async () => {
    vi.mocked(resizeToJpeg).mockImplementationOnce(() => Promise.reject(new PhotoUnreadableError()))
    await open()
    await choose([jpeg('flou.heic'), jpeg('mur.jpg')])
    expect(api.upload).toHaveBeenCalledTimes(1)
    expect(items()).toHaveLength(3)
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'flou.heic : Ce fichier n’est pas une photo',
    )
  })

  it('avance une photo d’un cran', async () => {
    await open()
    await button('Avancer la photo 2').trigger('click')
    await flushPromises()
    expect(api.reorder).toHaveBeenCalledWith(['p2', 'p1'])
    expect(items()[0]?.get('img').attributes('alt')).toBe('Photo 1 sur 2 de Club Roc')
  })

  it('enregistre la description modifiée, et l’efface quand elle est vidée', async () => {
    await open()
    const field = items()[1]?.get('input')
    await field?.setValue('  L’accueil  ')
    await button('Enregistrer la description').trigger('click')
    await flushPromises()
    expect(api.update).toHaveBeenLastCalledWith('p2', { altText: 'L’accueil' })
    expect(wrapper.text()).toContain('Description enregistrée.')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Enregistrer la description')).toBe(
      false,
    )

    await items()[0]?.get('input').setValue('   ')
    await button('Enregistrer la description').trigger('click')
    await flushPromises()
    expect(api.update).toHaveBeenLastCalledWith('p1', { altText: null })
  })

  it('supprimer laisse un « Annuler » qui remet la photo à sa place', async () => {
    await open()
    await button('Supprimer la photo 1').trigger('click')
    await flushPromises()
    expect(api.remove).toHaveBeenCalledWith('p1')
    expect(items()).toHaveLength(1)
    const banner = wrapper.get('[data-testid="photo-deleted"]')
    expect(banner.text()).toContain('Photo supprimée.')

    await button('Annuler').trigger('click')
    await flushPromises()
    expect(api.restore).toHaveBeenCalledWith('p1')
    expect(items()).toHaveLength(2)
    expect(items()[0]?.get('img').attributes('alt')).toBe('Le mur de bloc')
    expect(wrapper.find('[data-testid="photo-deleted"]').exists()).toBe(false)
  })

  it('l’« Annuler » disparaît à l’action suivante', async () => {
    await open()
    await button('Supprimer la photo 1').trigger('click')
    await flushPromises()
    await choose([jpeg('a.jpg')])
    expect(wrapper.find('[data-testid="photo-deleted"]').exists()).toBe(false)
  })

  it('dit quoi faire quand le serveur ne répond pas', async () => {
    await open()
    api.remove.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await button('Supprimer la photo 1').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Impossible de joindre le serveur')
    expect(items()).toHaveLength(2)
  })
})
