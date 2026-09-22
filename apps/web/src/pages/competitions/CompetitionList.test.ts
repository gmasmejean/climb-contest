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
import { stubDesktop } from '../../test-utils/media-query'
import CompetitionList from './CompetitionList.vue'

const stub = { template: '<div />' }

const competitions = [
  makeCompetition({
    id: 'a',
    name: 'Coupe d’été',
    venue: 'Gymnase Jean Moulin',
    status: 'closed',
    startsOn: '2026-07-04',
    endsOn: '2026-07-05',
  }),
  makeCompetition({
    id: 'b',
    name: 'Open de Lyon',
    venue: 'Bloc & Co',
    status: 'open',
    startsOn: '2099-03-01',
    endsOn: '2099-03-01',
  }),
  makeCompetition({
    id: 'c',
    name: 'Trophée des Écrins',
    venue: 'Briançon',
    status: 'draft',
    startsOn: '2099-11-15',
    endsOn: '2099-11-16',
  }),
  makeCompetition({
    id: 'd',
    name: 'Critérium régional',
    venue: 'Salle Roc',
    status: 'running',
    startsOn: '2026-09-19',
    endsOn: '2099-12-31',
  }),
]

describe('CompetitionList', () => {
  let router: ReturnType<typeof createRouter>
  let server: FakeCompetitionServer
  let wrapper: VueWrapper

  async function open(query = ''): Promise<void> {
    await router.push(`/competitions${query}`)
    await router.isReady()
    wrapper = mount(CompetitionList, {
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

  /** Les noms affichés, dans l'ordre de la liste. */
  const names = (): string[] =>
    wrapper.findAll('ul > li').map((li) => li.find('.font-medium').text())

  const buttonByText = (text: string) =>
    wrapper.findAll('button').find((button) => button.text().startsWith(text))

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/competitions', name: 'competition-list', component: CompetitionList },
        { path: '/competitions/new', name: 'competition-create', component: stub },
        { path: '/competitions/trash', name: 'competition-trash', component: stub },
        { path: '/competitions/:id', name: 'competition-detail', component: stub },
      ],
    })
    server = installFakeCompetitionServer(competitions)
    localStorage.clear()
  })

  afterEach(() => {
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  describe('recherche, filtres et tri', () => {
    it('affiche tout, les plus récentes d’abord, par défaut', async () => {
      await open()
      expect(names()).toEqual([
        'Trophée des Écrins',
        'Open de Lyon',
        'Critérium régional',
        'Coupe d’été',
      ])
      expect(wrapper.text()).toContain('4 compétitions')
    })

    it('cherche sans tenir compte des accents ni de la casse, et le garde dans l’adresse', async () => {
      await open()
      await wrapper.find('input[type="text"]').setValue('ECRINS')
      await flush()
      expect(names()).toEqual(['Trophée des Écrins'])
      expect(router.currentRoute.value.query['q']).toBe('ECRINS')
      expect(wrapper.text()).toContain('1 sur 4 compétitions')
    })

    it('cherche aussi dans le lieu', async () => {
      await open()
      await wrapper.find('input[type="text"]').setValue('briancon')
      await flush()
      expect(names()).toEqual(['Trophée des Écrins'])
    })

    it('reprend la vue depuis l’adresse : recherche, statut, tri, et ouvre les filtres', async () => {
      await open('?status=open,draft&sort=name&dir=asc')
      expect(names()).toEqual(['Open de Lyon', 'Trophée des Écrins'])
      expect(wrapper.find('#competition-filters').isVisible()).toBe(true)
      expect(buttonByText('Filtres')?.text()).toBe('Filtres (2)')
    })

    it('un statut cliqué filtre la liste et s’écrit dans l’adresse', async () => {
      await open()
      await buttonByText('Filtres')?.trigger('click')
      const chip = wrapper.findAll('button[aria-pressed]').find((b) => b.text() === 'Clôturée')
      await chip?.trigger('click')
      await flush()
      expect(names()).toEqual(['Coupe d’été'])
      expect(router.currentRoute.value.query['status']).toBe('closed')
      expect(chip?.attributes('aria-pressed')).toBe('true')

      await chip?.trigger('click')
      await flush()
      expect(names()).toHaveLength(4)
      expect(router.currentRoute.value.query['status']).toBeUndefined()
    })

    it('« À venir ou en cours » garde ce qui n’est pas terminé', async () => {
      await open()
      await buttonByText('Filtres')?.trigger('click')
      const upcoming = wrapper
        .findAll('button[aria-pressed]')
        .find((b) => b.text() === 'À venir ou en cours')
      await upcoming?.trigger('click')
      await flush()
      expect(names()).toEqual(['Trophée des Écrins', 'Open de Lyon', 'Critérium régional'])
    })

    it('filtre par période sur la date de début', async () => {
      await open('?from=2026-07-01&to=2026-09-30')
      expect(names()).toEqual(['Critérium régional', 'Coupe d’été'])
    })

    it('trie par nom, puis par statut selon le cycle de vie', async () => {
      await open()
      await wrapper.find('select').setValue('name:asc')
      await flush()
      expect(names()).toEqual([
        'Coupe d’été',
        'Critérium régional',
        'Open de Lyon',
        'Trophée des Écrins',
      ])
      expect(router.currentRoute.value.query).toMatchObject({ sort: 'name', dir: 'asc' })

      await wrapper.find('select').setValue('status:asc')
      await flush()
      // brouillon, ouverte, en cours, clôturée
      expect(names()).toEqual([
        'Trophée des Écrins',
        'Open de Lyon',
        'Critérium régional',
        'Coupe d’été',
      ])
    })

    it('dit qu’aucune compétition ne correspond, et « Réinitialiser » rend la liste', async () => {
      await open()
      await wrapper.find('input[type="text"]').setValue('zzz')
      await flush()
      expect(wrapper.text()).toContain('Aucune compétition ne correspond à votre recherche.')
      expect(names()).toEqual([])

      await buttonByText('Réinitialiser la recherche')?.trigger('click')
      await flush()
      expect(names()).toHaveLength(4)
      expect(router.currentRoute.value.query).toEqual({})
      expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('')
    })

    it('« Réinitialiser » efface aussi les filtres et le tri, pas seulement la recherche', async () => {
      await open('?q=lyon&status=open&sort=name&dir=asc')
      expect(names()).toEqual(['Open de Lyon'])
      await buttonByText('Réinitialiser')?.trigger('click')
      await flush()
      expect(router.currentRoute.value.query).toEqual({})
      expect(names()).toHaveLength(4)
    })

    it('ignore une adresse invalide sans casser la page', async () => {
      await open('?status=nimporte&sort=prix&from=demain')
      expect(names()).toHaveLength(4)
    })
  })

  describe('mise à la corbeille', () => {
    it('affiche le nombre de compétitions à la corbeille sur le lien', async () => {
      installFakeCompetitionServer(competitions, [
        makeCompetition({ id: 'x', deletedAt: '2026-09-01T10:00:00.000Z' }),
        makeCompetition({ id: 'y', deletedAt: '2026-09-02T10:00:00.000Z' }),
      ])
      await open()
      expect(wrapper.text()).toContain('Corbeille (2)')
    })

    it('n’affiche pas de nombre quand la corbeille est vide', async () => {
      await open()
      expect(buttonByText('Corbeille')?.text()).toBe('Corbeille')
    })

    it('« Sélectionner » remplace les liens par des cases, et une compétition en cours n’est pas cochable', async () => {
      await open()
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
      await buttonByText('Sélectionner')?.trigger('click')

      const boxes = wrapper.findAll('input[type="checkbox"]')
      expect(boxes).toHaveLength(4)
      const running = wrapper
        .findAll('ul > li')
        .find((li) => li.text().includes('Critérium régional'))
      expect(running?.find('input').attributes('disabled')).toBeDefined()
      expect(running?.text()).toContain('clôturez-la pour pouvoir la supprimer')
    })

    it('met plusieurs compétitions à la corbeille sans confirmation, puis le dit', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      const rows = wrapper.findAll('ul > li')
      await rows
        .find((li) => li.text().includes('Coupe d’été'))
        ?.find('input')
        .setValue(true)
      await rows
        .find((li) => li.text().includes('Open de Lyon'))
        ?.find('input')
        .setValue(true)
      expect(wrapper.text()).toContain('2 sélectionnées')

      await buttonByText('Mettre à la corbeille')?.trigger('click')
      await flush()

      // Aucune modale de confirmation : les appels partent directement.
      expect(server.calls.filter((call) => call.startsWith('DELETE'))).toEqual([
        'DELETE /competitions/a',
        'DELETE /competitions/b',
      ])
      expect(document.body.querySelector('[role="dialog"]')).toBeNull()
      expect(wrapper.find('[role="status"]').text()).toContain(
        '2 compétitions ont été mises à la corbeille.',
      )
      expect(wrapper.text()).toContain('Voir la corbeille pour la restaurer')
      expect(names()).toEqual(['Trophée des Écrins', 'Critérium régional'])
      // Le mode sélection se referme quand tout a réussi.
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    })

    it('« Tout sélectionner » ne prend pas les compétitions en cours', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      await buttonByText('Tout sélectionner')?.trigger('click')
      expect(wrapper.text()).toContain('3 sélectionnées')
    })

    it('dit ce qui a été fait ET ce qui a été refusé, et garde le refus sélectionné', async () => {
      server.failing.set('a', {
        status: 409,
        title: 'Compétition en cours',
        detail: 'Clôturez-la d’abord (Infos → Changer le statut).',
      })
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      const rows = wrapper.findAll('ul > li')
      await rows
        .find((li) => li.text().includes('Coupe d’été'))
        ?.find('input')
        .setValue(true)
      await rows
        .find((li) => li.text().includes('Open de Lyon'))
        ?.find('input')
        .setValue(true)
      await buttonByText('Mettre à la corbeille')?.trigger('click')
      await flush()

      const bilan = wrapper.find('[role="status"]').text()
      expect(bilan).toContain('« Open de Lyon » a été mise à la corbeille.')
      expect(bilan).toContain('Une compétition est restée telle quelle.')
      expect(bilan).toContain('« Coupe d’été » : Clôturez-la d’abord (Infos → Changer le statut).')
      expect(names()).toContain('Coupe d’été')
      expect(names()).not.toContain('Open de Lyon')
      // Toujours en mode sélection, avec ce qui a échoué encore coché.
      expect(wrapper.text()).toContain('1 sélectionnée')
    })

    it('si le réseau tombe, dit que rien n’a été modifié et ne perd rien', async () => {
      await open()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
      )
      await buttonByText('Sélectionner')?.trigger('click')
      await wrapper.findAll('ul > li')[0]?.find('input').setValue(true)
      await buttonByText('Mettre à la corbeille')?.trigger('click')
      await flush()

      const bilan = wrapper.find('[role="status"]').text()
      expect(bilan).toContain('Rien n’a été modifié.')
      expect(bilan).toContain('Impossible de joindre le serveur')
      expect(wrapper.text()).toContain('1 sélectionnée')
    })

    it('ne garde pas sélectionné ce que le filtre a caché', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      await wrapper
        .findAll('ul > li')
        .find((li) => li.text().includes('Coupe d’été'))
        ?.find('input')
        .setValue(true)
      expect(wrapper.text()).toContain('1 sélectionnée')

      await wrapper.find('input[type="text"]').setValue('lyon')
      await flush()
      expect(wrapper.text()).toContain('0 sélectionnée')
    })

    it('« Terminer » quitte le mode sélection et vide la sélection', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      await wrapper.findAll('ul > li')[0]?.find('input').setValue(true)
      await buttonByText('Terminer')?.trigger('click')
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
      expect(server.calls.some((call) => call.startsWith('DELETE'))).toBe(false)
    })
  })

  it('sans aucune compétition, invite à créer la première (pas de filtres)', async () => {
    installFakeCompetitionServer([])
    await open()
    expect(wrapper.text()).toContain('Aucune compétition pour l')
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
  })
  describe('sur grand écran (Lot 18)', () => {
    /** Le nom vit dans l'en-tête de ligne, qui porte le lien vers la compétition. */
    const rowNames = (): string[] =>
      wrapper.findAll('[data-testid="data-list-row"] th').map((cell) => cell.text())

    const headerByText = (text: string) =>
      wrapper.findAll('thead th').find((th) => th.text().startsWith(text))

    beforeEach(() => {
      stubDesktop(true)
    })

    it('rend un tableau, et un seul arbre : plus aucune carte', async () => {
      await open()
      expect(wrapper.find('table').exists()).toBe(true)
      expect(wrapper.find('ul').exists()).toBe(false)
      expect(rowNames()).toHaveLength(4)
    })

    it('retire le sélecteur de tri, remplacé par les en-têtes', async () => {
      await open()
      expect(wrapper.find('select').exists()).toBe(false)
    })

    it('trie par nom au clic sur l’en-tête et l’écrit dans l’adresse', async () => {
      await open()
      await headerByText('Nom')?.find('button').trigger('click')
      await flush()
      expect(router.currentRoute.value.query).toMatchObject({ sort: 'name', dir: 'asc' })
      expect(rowNames()[0]).toBe('Coupe d’été')
    })

    it('inverse le sens au second clic', async () => {
      await open()
      await headerByText('Nom')?.find('button').trigger('click')
      await flush()
      await headerByText('Nom')?.find('button').trigger('click')
      await flush()
      // `desc` est le sens par défaut : il ne s'écrit pas dans l'adresse.
      expect(router.currentRoute.value.query).toEqual({ sort: 'name' })
      expect(rowNames()[0]).toBe('Trophée des Écrins')
    })

    it('annonce le tri de l’adresse, une seule colonne à la fois', async () => {
      await open('?sort=name&dir=asc')
      expect(headerByText('Nom')?.attributes('aria-sort')).toBe('ascending')
      expect(headerByText('Début')?.attributes('aria-sort')).toBe('none')
      expect(headerByText('Lieu')?.attributes('aria-sort')).toBeUndefined()
    })

    it('montre le lieu, invisible sur la carte', async () => {
      await open()
      expect(wrapper.text()).toContain('Gymnase Jean Moulin')
    })

    it('coche une ligne et refuse celle qui est en cours', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      const boxes = wrapper.findAll('input[type="checkbox"]')
      expect(boxes).toHaveLength(4)
      const running = wrapper
        .findAll('[data-testid="data-list-row"]')
        .find((row) => row.text().includes('Critérium régional'))
      expect(running?.find('input[type="checkbox"]').attributes('disabled')).toBeDefined()

      await boxes[0]?.trigger('change')
      expect(wrapper.text()).toContain('1 sélectionnée')
    })

    it('nomme chaque case par sa compétition', async () => {
      await open()
      await buttonByText('Sélectionner')?.trigger('click')
      const labels = wrapper
        .findAll('input[type="checkbox"]')
        .map((box) => box.attributes('aria-label'))
      expect(labels).toContain('Open de Lyon')
    })
  })
})
