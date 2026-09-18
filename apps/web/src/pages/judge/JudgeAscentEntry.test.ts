import { useToast } from '@climbcontest/ui'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import { judgeDb } from '../../judge/local-db'
import { flushLiveQueries } from '../../test-utils/flush'
import JudgeAscentEntry from './JudgeAscentEntry.vue'

const routeDetail = {
  route: { id: 'route-1', number: 3, name: null, holdCount: 40, categories: [] },
  round: { id: 'round-1', type: 'qualification' as const },
  timingEnabled: false,
  competitors: [
    {
      id: 'comp-1',
      bib: 47,
      firstName: 'Léa',
      lastName: 'Martin',
      categoryLabel: 'U16 Femme',
      ascent: null,
    },
  ],
}

describe('JudgeAscentEntry', () => {
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/j/routes/:routeId/competitors/:competitorId',
          name: 'judge-ascent-entry',
          component: JudgeAscentEntry,
        },
        { path: '/j/routes/:routeId', name: 'judge-route', component: { template: '<div />' } },
      ],
    })
    // Aucun test de ce fichier ne doit toucher le réseau : la saisie écrit en
    // local (Dexie) puis enfile dans `packages/sync` — c'est CE contenu que
    // les tests vérifient, jamais le corps d'une requête réseau.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau indisponible en test')))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await judgeDb.routeDetails.clear()
    await judgeDb.queue.clear()
    await judgeDb.lastSubmission.clear()
  })

  function digitButton(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.findAll('button').find((button) => button.text() === label)
  }

  it('compose une prise, affiche le récapitulatif exact et confirme', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushLiveQueries()

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin')

    await digitButton(wrapper, '2')?.trigger('click')
    await digitButton(wrapper, '5')?.trigger('click')
    await digitButton(wrapper, '+')?.trigger('click')

    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin — Voie 3 — prise 25+')

    const confirmButton = wrapper.findAll('button').find((b) => b.text() === 'Confirmer')
    await confirmButton?.trigger('click')

    // Écrit dans IndexedDB AVANT tout réseau (SPEC.md § 6.3) : la saisie doit
    // être là, peu importe que le `fetch` de fond échoue. `trigger()`
    // n'attend que le prochain tick Vue, pas la chaîne d'écritures Dexie
    // internes à `confirm()` — on attend donc explicitement son résultat.
    const queued = await vi.waitFor(async () => {
      const rows = await judgeDb.queue.toArray()
      expect(rows).toHaveLength(1)
      return rows
    })
    const item = queued[0]
    expect(item?.kind).toBe('create')
    const payload = item?.payload as {
      holdNumber: number
      modifier: string
      routeId: string
      competitorId: string
    }
    expect(payload.holdNumber).toBe(25)
    expect(payload.modifier).toBe('plus')
    expect(payload.routeId).toBe('route-1')
    expect(payload.competitorId).toBe('comp-1')

    // Écriture optimiste immédiate du cache local (ADR-012).
    const stored = await judgeDb.routeDetails.get('route-1')
    expect(stored?.detail.competitors[0]?.ascent?.holdNumber).toBe(25)

    expect(router.currentRoute.value.name).toBe('judge-route')

    // Régression : l'écriture optimiste ci-dessus ouvre IMMÉDIATEMENT la
    // fenêtre de correction (ADR-007) pour ce compétiteur — si le texte du
    // toast relit `mode` après cette écriture au lieu de la capturer avant,
    // une toute première création s'annonce à tort comme une correction.
    const { toasts } = useToast()
    expect(toasts.at(-1)?.text).toBe('Passage enregistré ✓')
  })

  it('un TOP vide le numéro de prise et l’affiche dans le récapitulatif', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushLiveQueries()

    const topButton = wrapper.findAll('button').find((b) => b.text() === 'TOP')
    await topButton?.trigger('click')
    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).toContain('Dossard 47 — Léa Martin — Voie 3 — TOP')
  })

  it('refuse d’avancer au récapitulatif sans prise ni statut choisi', async () => {
    await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })

    await router.push('/j/routes/route-1/competitors/comp-1')
    await router.isReady()
    const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
    await flushLiveQueries()

    const recapButton = wrapper.findAll('button').find((b) => b.text() === 'Voir le récapitulatif')
    await recapButton?.trigger('click')

    expect(wrapper.text()).not.toContain('— Voie 3 —')
    expect(wrapper.text()).toContain('Indiquez la prise atteinte')
  })
})
