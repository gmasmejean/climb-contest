import type { Competition } from '@climbcontest/contracts'
import { useToast } from '@climbcontest/ui'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InfosTab from './InfosTab.vue'

const competition: Competition = {
  id: 'c1',
  organizationId: 'club1',
  name: 'Coupe du club',
  venue: 'Salle Roc',
  startsOn: '2026-06-10',
  endsOn: '2026-06-11',
  discipline: 'difficulty',
  format: 'contest',
  scoringEngineId: 'ffme-difficulty-2026',
  scoringConfig: {},
  status: 'draft',
  publicSlug: 'coupe-du-club',
  timingEnabled: false,
  judgePinRequired: false,
  judgeCredentialsStored: true,
  createdBy: 'user1',
  purgedAt: null,
  deletedAt: null,
  addressLabel: null,
  postcode: null,
  city: null,
  latitude: null,
  longitude: null,
  banId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

vi.mock('../../../lib/leaflet-map', () => ({
  createLocationMap: vi.fn(() => ({ destroy: vi.fn() })),
}))

function open(props: { competition: Competition } = { competition }) {
  return mount(InfosTab, {
    props,
    global: {
      plugins: [
        [
          VueQueryPlugin,
          { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        ],
      ],
    },
  })
}

describe('InfosTab — date de fin', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('suit la date de début quand celle-ci change', async () => {
    const wrapper = open()
    const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

    await startsOn?.setValue('2026-07-04')

    expect(endsOn?.element.value).toBe('2026-07-04')
  })

  it('garde la date de fin enregistrée tant que la date de début ne change pas', () => {
    const wrapper = open()
    const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

    expect(startsOn?.element.value).toBe('2026-06-10')
    expect(endsOn?.element.value).toBe('2026-06-11')
  })

  it('reste modifiable à la main après la date de début', async () => {
    const wrapper = open()
    const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

    await startsOn?.setValue('2026-07-04')
    await endsOn?.setValue('2026-07-05')

    expect(endsOn?.element.value).toBe('2026-07-05')
  })

  it('ignore une saisie partielle (champ date vidé)', async () => {
    const wrapper = open()
    const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

    await startsOn?.setValue('')

    expect(endsOn?.element.value).toBe('2026-06-11')
  })

  it('ne touche pas à la date de fin d’un brouillon restauré', async () => {
    localStorage.setItem(
      'climbcontest:draft:competition-edit-c1',
      JSON.stringify({ startsOn: '2026-08-01', endsOn: '2026-08-02' }),
    )
    const wrapper = open()
    await wrapper.vm.$nextTick()
    const [startsOn, endsOn] = wrapper.findAll<HTMLInputElement>('input[type="date"]')

    expect(startsOn?.element.value).toBe('2026-08-01')
    expect(endsOn?.element.value).toBe('2026-08-02')
  })
})

describe('InfosTab — changement de statut', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('montre tel quel le refus du serveur tant qu’une catégorie est ouverte (ADR-065)', async () => {
    const detail =
      'Fermez d’abord les catégories ouvertes (onglet Pilotage) avant de passer la compétition à « Clôturée ».'
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ title: 'Des catégories sont encore ouvertes', detail }), {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    )
    const { toasts } = useToast()
    toasts.splice(0, toasts.length)

    const wrapper = open()
    await wrapper.get('select').setValue('closed')
    const apply = wrapper.findAll('button').find((b) => b.text() === 'Appliquer')
    await apply?.trigger('click')
    await flushPromises()

    expect(toasts.map((t) => t.text)).toContain(detail)
    expect(toasts.find((t) => t.text === detail)?.variant).toBe('error')
  })
})

describe('InfosTab — lieu (ADR-089)', () => {
  const address = {
    label: '8 Boulevard du Port 80000 Amiens',
    postcode: '80000',
    city: 'Amiens',
    latitude: 49.897442,
    longitude: 2.290084,
    banId: '80021_6590_00008',
  }
  const profile = {
    id: '0189dcd5-5311-7d40-8db0-9496a2eef37b',
    name: 'Roc’n Bloc',
    type: 'gym',
    description: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    address,
  }
  const atOrganization: Competition = {
    ...competition,
    venue: 'Roc’n Bloc',
    addressLabel: address.label,
    postcode: '80000',
    city: 'Amiens',
    latitude: 49.897442,
    longitude: 2.290084,
    banId: '80021_6590_00008',
  }
  let patches: unknown[]

  beforeEach(() => {
    localStorage.clear()
    patches = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const reply = (body: unknown) =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          )
        if (url.endsWith('/api/v1/organization')) return reply(profile)
        if (init?.method === 'PATCH' && typeof init.body === 'string') {
          const body: unknown = JSON.parse(init.body)
          patches.push(body)
          return reply({ ...atOrganization, ...(body as object) })
        }
        return Promise.reject(new TypeError(`inattendu : ${url}`))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const radio = (wrapper: ReturnType<typeof open>, value: string) =>
    wrapper.get<HTMLInputElement>(`input[type="radio"][value="${value}"]`)

  it('reconnaît le lieu de l’organisation et le résume, sans champ à remplir', async () => {
    const wrapper = open({ competition: atOrganization })
    await flushPromises()
    expect(radio(wrapper, 'organization').element.checked).toBe(true)
    expect(wrapper.text()).toContain('Roc’n Bloc — 8 Boulevard du Port 80000 Amiens')
    expect(wrapper.find('input[role="combobox"]').exists()).toBe(false)
  })

  it('un autre lieu ouvre la saisie ; enregistrer envoie le nom et l’adresse', async () => {
    const wrapper = open()
    await flushPromises()
    expect(radio(wrapper, 'other').element.checked).toBe(true)
    expect((wrapper.get('input[role="combobox"]').element as HTMLInputElement).value).toBe('')

    await radio(wrapper, 'organization').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patches[0]).toMatchObject({ venue: 'Roc’n Bloc', address })
  })

  it('« Autre lieu » garde le lieu actuel pour n’en retoucher qu’un détail', async () => {
    const wrapper = open({ competition: atOrganization })
    await flushPromises()
    await radio(wrapper, 'other').setValue(true)
    const venue = wrapper
      .findAll('input')
      .find((input) => (input.element as HTMLInputElement).value === 'Roc’n Bloc')
    expect(venue).toBeDefined()
    await venue?.setValue('Roc’n Bloc — salle 2')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(patches[0]).toMatchObject({ venue: 'Roc’n Bloc — salle 2', address })
  })
})
