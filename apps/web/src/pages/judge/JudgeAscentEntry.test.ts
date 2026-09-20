import { useToast } from '@climbcontest/ui'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'

import {
  DRAFT_MAX_AGE_MS,
  parseAscentDraft,
  saveAscentDraft,
  type AscentDraftValues,
  type DraftTarget,
} from '../../judge/ascent-draft'
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
    localStorage.clear()
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

  // ADR-061 : la saisie non confirmée survit à un rechargement de page.
  describe('brouillon de saisie', () => {
    const DRAFT_KEY = 'climbcontest.judge.ascentDraft'
    const RESTORED_TOAST = 'Saisie retrouvée : vérifiez-la avant de valider.'

    const screen: DraftTarget = {
      routeId: 'route-1',
      competitorId: 'comp-1',
      baseAscentId: null,
      holdCount: 40,
    }
    const draftValues: AscentDraftValues = {
      holdNumber: 33,
      modifier: 'plus',
      isTop: false,
      status: 'valid',
      climbTimeMs: null,
    }

    async function openEntry() {
      await router.push('/j/routes/route-1/competitors/comp-1')
      await router.isReady()
      const wrapper = mount(JudgeAscentEntry, { global: { plugins: [router] } })
      await flushLiveQueries()
      // `flushLiveQueries` ne garantit pas que Dexie a déjà émis (fragile sous
      // charge, voir son commentaire) : on attend que l'écran soit réellement là.
      await vi.waitFor(() => expect(wrapper.text()).toContain('Dossard 47'))
      return wrapper
    }

    function buttonLabelled(wrapper: ReturnType<typeof mount>, label: string) {
      return wrapper.findAll('button').find((b) => b.text() === label)
    }

    // Contrairement à `?.trigger`, un bouton introuvable fait échouer le test
    // au lieu de le laisser continuer sans avoir rien saisi.
    async function tap(wrapper: ReturnType<typeof mount>, label: string): Promise<void> {
      const button = buttonLabelled(wrapper, label)
      if (!button) throw new Error(`Bouton « ${label} » introuvable : ${wrapper.text()}`)
      await button.trigger('click')
    }

    async function recapText(wrapper: ReturnType<typeof mount>): Promise<string> {
      await tap(wrapper, 'Voir le récapitulatif')
      return wrapper.text()
    }

    // La pile de toasts est partagée et plafonnée (3) : on la vide avant chaque
    // test et on cherche des TEXTES, jamais un effectif.
    function toastTexts(): string[] {
      return useToast().toasts.map((toast) => toast.text)
    }

    // Le moteur de synchronisation est un singleton : il peut réécrire dans Dexie
    // l'élément d'un test précédent. On cherche donc SA saisie, pas un effectif.
    async function queuedHoldNumbers(): Promise<Array<number | null>> {
      const rows = await judgeDb.queue.toArray()
      return rows.map((row) => row.payload.holdNumber)
    }

    function storedDraft() {
      const raw = localStorage.getItem(DRAFT_KEY)
      return raw === null ? null : parseAscentDraft(raw)
    }

    beforeEach(async () => {
      const { toasts, dismiss } = useToast()
      for (const toast of [...toasts]) dismiss(toast.id)
      await judgeDb.routeDetails.put({ routeId: 'route-1', detail: routeDetail })
    })

    it('n’écrit rien tant que le juge n’a rien changé', async () => {
      await openEntry()

      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('écrit le brouillon dès l’appui, dans le même tour', async () => {
      const wrapper = await openEntry()

      // Pas d'`await` sur le clic : le brouillon doit déjà être écrit avant le
      // prochain rendu (un rechargement juste après un appui ne doit rien perdre).
      void tap(wrapper, '2')

      expect(storedDraft()).toMatchObject({
        routeId: 'route-1',
        competitorId: 'comp-1',
        baseAscentId: null,
        holdNumber: 2,
        status: 'valid',
      })
    })

    it('un TOP est écrit sans numéro de prise, jamais dans un état incohérent', async () => {
      const wrapper = await openEntry()
      await tap(wrapper, '2')
      await tap(wrapper, 'TOP')

      expect(storedDraft()).toMatchObject({ isTop: true, holdNumber: null, status: 'valid' })
    })

    it('efface le brouillon quand le juge revient à l’état de départ', async () => {
      const wrapper = await openEntry()
      await tap(wrapper, '+')
      expect(storedDraft()).toMatchObject({ modifier: 'plus' })

      await tap(wrapper, 'Neutre')

      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('restaure la saisie après un rechargement, dans l’étape de saisie, avec un message', async () => {
      const first = await openEntry()
      await tap(first, '3')
      await tap(first, '7')
      await tap(first, '+')
      first.unmount() // le rechargement : tout l'état en mémoire disparaît

      const second = await openEntry()

      // L'étape de saisie, pas le récapitulatif : le juge revoit avant de confirmer.
      expect(buttonLabelled(second, 'Voir le récapitulatif')).toBeDefined()
      expect(buttonLabelled(second, 'Confirmer')).toBeUndefined()
      expect(toastTexts()).toEqual([RESTORED_TOAST])
      expect(await recapText(second)).toContain('prise 37+')
      // Rien n'est parti tout seul.
      expect(await queuedHoldNumbers()).not.toContain(37)
    })

    it('ne repousse pas la péremption en restaurant', async () => {
      const savedAt = Date.now() - 4 * 60 * 1000
      saveAscentDraft(screen, draftValues, savedAt)

      await openEntry()

      expect(storedDraft()?.savedAt).toBe(savedAt)
    })

    it('ne restaure pas un brouillon de plus de 10 minutes et le supprime', async () => {
      saveAscentDraft(screen, draftValues, Date.now() - DRAFT_MAX_AGE_MS - 1000)

      const wrapper = await openEntry()

      expect(toastTexts()).not.toContain(RESTORED_TOAST)
      expect(await recapText(wrapper)).toContain('Indiquez la prise atteinte')
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('ne restaure pas le brouillon d’un autre compétiteur, et le laisse en place', async () => {
      saveAscentDraft({ ...screen, competitorId: 'comp-2' }, draftValues, Date.now())

      const wrapper = await openEntry()

      expect(toastTexts()).not.toContain(RESTORED_TOAST)
      expect(await recapText(wrapper)).toContain('Indiquez la prise atteinte')
      expect(storedDraft()?.competitorId).toBe('comp-2')
    })

    it('ne restaure pas une prise qui n’existe pas sur cette voie', async () => {
      saveAscentDraft(screen, { ...draftValues, holdNumber: 41 }, Date.now())

      const wrapper = await openEntry()

      expect(await recapText(wrapper)).toContain('Indiquez la prise atteinte')
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('efface le brouillon une fois la saisie écrite dans la file', async () => {
      const wrapper = await openEntry()
      await tap(wrapper, '2')
      await tap(wrapper, 'Voir le récapitulatif')
      expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull()

      await tap(wrapper, 'Confirmer')

      await vi.waitFor(async () => {
        expect(await queuedHoldNumbers()).toContain(2)
        expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
      })
    })

    it('n’ajoute rien à une saisie déjà écrite : brouillon resté derrière, page rechargée', async () => {
      // La page s'est rechargée entre l'écriture dans la file et l'effacement du
      // brouillon : le passage existe (`a1`) alors que le brouillon date d'une création.
      const recordedAt = new Date().toISOString()
      await judgeDb.routeDetails.put({
        routeId: 'route-1',
        detail: {
          ...routeDetail,
          competitors: [
            {
              ...routeDetail.competitors[0]!,
              ascent: {
                id: 'a1',
                holdNumber: 30,
                modifier: 'none',
                isTop: false,
                status: 'valid',
                climbTimeMs: null,
                recordedAt,
              },
            },
          ],
        },
      })
      await judgeDb.lastSubmission.put({
        key: 'current',
        competitorId: 'comp-1',
        ascentId: 'a1',
        recordedAt,
        correctableUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      saveAscentDraft(screen, draftValues, Date.now())

      const wrapper = await openEntry()

      // C'est bien l'écran de correction, prérempli par le passage écrit (30) —
      // pas par le brouillon périmé (33).
      expect(wrapper.text()).toContain('Correction')
      expect(toastTexts()).not.toContain(RESTORED_TOAST)
      expect(await recapText(wrapper)).toContain('prise 30')
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    })

    it('restaure aussi une correction en cours du même passage', async () => {
      const recordedAt = new Date().toISOString()
      await judgeDb.routeDetails.put({
        routeId: 'route-1',
        detail: {
          ...routeDetail,
          competitors: [
            {
              ...routeDetail.competitors[0]!,
              ascent: {
                id: 'a1',
                holdNumber: 30,
                modifier: 'none',
                isTop: false,
                status: 'valid',
                climbTimeMs: null,
                recordedAt,
              },
            },
          ],
        },
      })
      await judgeDb.lastSubmission.put({
        key: 'current',
        competitorId: 'comp-1',
        ascentId: 'a1',
        recordedAt,
        correctableUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      })
      saveAscentDraft({ ...screen, baseAscentId: 'a1' }, draftValues, Date.now())

      const wrapper = await openEntry()

      expect(toastTexts()).toEqual([RESTORED_TOAST])
      expect(await recapText(wrapper)).toContain('prise 33+')
    })
  })
})
