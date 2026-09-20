import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import {
  flush,
  installFakeCompetitionServer,
  makeCompetition,
  type FakeCompetitionServer,
} from '../../test-utils/fake-competition-server'
import CompetitionTrash from './CompetitionTrash.vue'

const stub = { template: '<div />' }
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

const trashed = [
  makeCompetition({ id: 'x', name: 'Coupe d’été', deletedAt: daysAgo(0) }),
  makeCompetition({ id: 'y', name: 'Open de Lyon', deletedAt: daysAgo(3) }),
  makeCompetition({ id: 'z', name: 'Trophée des Écrins', deletedAt: daysAgo(1) }),
]

describe('CompetitionTrash', () => {
  let router: ReturnType<typeof createRouter>
  let server: FakeCompetitionServer
  let wrapper: VueWrapper

  async function open(): Promise<void> {
    await router.push('/competitions/trash')
    await router.isReady()
    wrapper = mount(CompetitionTrash, {
      attachTo: document.body,
      global: {
        plugins: [
          router,
          [
            VueQueryPlugin,
            { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          ],
        ],
      },
    })
    await flush()
  }

  const rows = () => wrapper.findAll('ul > li').filter((li) => li.find('input').exists())
  const rowOf = (name: string) => rows().find((li) => li.text().includes(name))
  const buttonByText = (text: string) =>
    wrapper.findAll('button').find((button) => button.text().startsWith(text))
  /** La modale est téléportée dans `body`, hors du composant. */
  const dialog = (): HTMLElement | null => document.body.querySelector('[role="dialog"]')
  const dialogButton = (text: string): HTMLButtonElement | undefined =>
    [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === text)

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/competitions', name: 'competition-list', component: stub },
        { path: '/competitions/trash', name: 'competition-trash', component: CompetitionTrash },
      ],
    })
    server = installFakeCompetitionServer([], trashed)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('liste ce qui est à la corbeille avec l’ancienneté', async () => {
    await open()
    expect(rows()).toHaveLength(3)
    expect(rowOf('Coupe d’été')?.text()).toContain('Mise à la corbeille aujourd’hui')
    expect(rowOf('Trophée des Écrins')?.text()).toContain('À la corbeille depuis 1 jour')
    expect(rowOf('Open de Lyon')?.text()).toContain('À la corbeille depuis 3 jours')
    expect(wrapper.text()).toContain('3 compétitions dans la corbeille')
  })

  it('explique ce que change la corbeille', async () => {
    await open()
    expect(wrapper.text()).toContain('Vous pouvez la restaurer à tout moment')
    expect(wrapper.text()).toContain('rien n’est effacé')
  })

  it('dit quand la corbeille est vide', async () => {
    server = installFakeCompetitionServer([], [])
    await open()
    expect(wrapper.text()).toContain('La corbeille est vide.')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  describe('restauration', () => {
    it('restaure une compétition d’un clic, sans confirmation', async () => {
      await open()
      await rowOf('Open de Lyon')
        ?.findAll('button')
        .find((b) => b.text() === 'Restaurer')
        ?.trigger('click')
      await flush()

      expect(server.calls).toContain('POST /competitions/y/restore')
      expect(dialog()).toBeNull()
      expect(wrapper.find('[role="status"]').text()).toContain('« Open de Lyon » a été restaurée.')
      expect(rows()).toHaveLength(2)
      expect(rowOf('Open de Lyon')).toBeUndefined()
    })

    it('restaure plusieurs compétitions sélectionnées', async () => {
      await open()
      await rowOf('Coupe d’été')?.find('input').setValue(true)
      await rowOf('Trophée des Écrins')?.find('input').setValue(true)
      expect(wrapper.text()).toContain('2 sélectionnées')

      await wrapper
        .findAll('button')
        .filter((b) => b.text() === 'Restaurer')
        .at(-1)
        ?.trigger('click')
      await flush()

      expect(server.calls.filter((c) => c.includes('/restore'))).toEqual([
        'POST /competitions/x/restore',
        'POST /competitions/z/restore',
      ])
      expect(wrapper.find('[role="status"]').text()).toContain('2 compétitions ont été restaurées.')
      expect(rows()).toHaveLength(1)
    })
  })

  describe('suppression définitive', () => {
    it('ne supprime rien sans passer par la confirmation', async () => {
      await open()
      await rowOf('Coupe d’été')?.find('input').setValue(true)
      await buttonByText('Supprimer définitivement')?.trigger('click')

      expect(dialog()).not.toBeNull()
      expect(server.calls.some((c) => c.includes('/permanent'))).toBe(false)
      expect(dialog()?.textContent).toContain('Cette action est irréversible')
      expect(dialog()?.textContent).toContain('Coupe d’été')
    })

    it('« Annuler » referme la modale et ne supprime rien', async () => {
      await open()
      await rowOf('Coupe d’été')?.find('input').setValue(true)
      await buttonByText('Supprimer définitivement')?.trigger('click')
      dialogButton('Annuler')?.click()
      await flush()

      expect(dialog()).toBeNull()
      expect(server.calls.some((c) => c.includes('/permanent'))).toBe(false)
      expect(rows()).toHaveLength(3)
    })

    it('supprime ce qui est sélectionné après confirmation, et le dit', async () => {
      await open()
      await rowOf('Coupe d’été')?.find('input').setValue(true)
      await rowOf('Open de Lyon')?.find('input').setValue(true)
      await buttonByText('Supprimer définitivement')?.trigger('click')
      expect(dialog()?.textContent).toContain('Ces 2 compétitions et toutes leurs données')

      dialogButton('Supprimer définitivement')?.click()
      await flush()

      expect(server.calls.filter((c) => c.includes('/permanent'))).toEqual([
        'DELETE /competitions/x/permanent',
        'DELETE /competitions/y/permanent',
      ])
      expect(dialog()).toBeNull()
      expect(wrapper.find('[role="status"]').text()).toContain(
        '2 compétitions ont été supprimées définitivement.',
      )
      expect(rows().map((li) => li.text())).toHaveLength(1)
      expect(rowOf('Trophée des Écrins')).toBeDefined()
    })

    it('la modale garde la liste figée à l’ouverture, même si la sélection change derrière', async () => {
      await open()
      await rowOf('Coupe d’été')?.find('input').setValue(true)
      await buttonByText('Supprimer définitivement')?.trigger('click')
      // Le fond est masqué par la modale ; on simule tout de même un changement de sélection.
      await rowOf('Open de Lyon')?.find('input').setValue(true)
      dialogButton('Supprimer définitivement')?.click()
      await flush()

      expect(server.calls.filter((c) => c.includes('/permanent'))).toEqual([
        'DELETE /competitions/x/permanent',
      ])
    })

    it('abrège une longue liste de noms dans la modale', async () => {
      const many = Array.from({ length: 8 }, (_, i) =>
        makeCompetition({ id: `m${i}`, name: `Compétition ${i}`, deletedAt: daysAgo(i) }),
      )
      server = installFakeCompetitionServer([], many)
      await open()
      await buttonByText('Tout sélectionner')?.trigger('click')
      await buttonByText('Supprimer définitivement')?.trigger('click')

      expect(dialog()?.querySelectorAll('li')).toHaveLength(6)
      expect(dialog()?.textContent).toContain('et 3 autres')
    })

    it('dit ce qui est supprimé et ce qui ne l’est pas, et garde le refus sélectionné', async () => {
      server.failing.set('y', {
        status: 500,
        title: 'Stockage indisponible',
        detail: 'Les vidéos ne peuvent pas être supprimées pour le moment. Rien n’a été supprimé.',
      })
      await open()
      await buttonByText('Tout sélectionner')?.trigger('click')
      await buttonByText('Supprimer définitivement')?.trigger('click')
      dialogButton('Supprimer définitivement')?.click()
      await flush()

      const bilan = wrapper.find('[role="status"]').text()
      expect(bilan).toContain('2 compétitions ont été supprimées définitivement.')
      expect(bilan).toContain('Une compétition est restée telle quelle.')
      expect(bilan).toContain('« Open de Lyon » : Les vidéos ne peuvent pas être supprimées')
      expect(rows()).toHaveLength(1)
      expect(wrapper.text()).toContain('1 sélectionnée')
    })

    it('les boutons d’action sont désactivés tant que rien n’est sélectionné', async () => {
      await open()
      expect(buttonByText('Supprimer définitivement')?.attributes('disabled')).toBeDefined()
      const bulkRestore = wrapper
        .findAll('button')
        .filter((b) => b.text() === 'Restaurer')
        .at(-1)
      expect(bulkRestore?.attributes('disabled')).toBeDefined()
    })
  })

  it('reste lisible quand le réseau tombe en cours d’action : le bilan ne disparaît pas', async () => {
    await open()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    await rowOf('Coupe d’été')
      ?.findAll('button')
      .find((b) => b.text() === 'Restaurer')
      ?.trigger('click')
    await flush()

    expect(wrapper.find('[role="status"]').text()).toContain('Rien n’a été modifié.')
    expect(rows()).toHaveLength(3)
  })
})
