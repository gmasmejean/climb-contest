import type { Competition } from '@climbcontest/contracts'
import { useToast } from '@climbcontest/ui'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InfosTab from './InfosTab.vue'

const competition: Competition = {
  id: 'c1',
  clubId: 'club1',
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
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

function open() {
  return mount(InfosTab, {
    props: { competition },
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
