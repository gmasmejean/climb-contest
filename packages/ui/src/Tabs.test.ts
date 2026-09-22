import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Tabs from './Tabs.vue'

const tabs = [
  { id: 'infos', label: 'Infos' },
  { id: 'categories', label: 'Catégories' },
  { id: 'voies', label: 'Voies' },
]

const grouped = [
  { id: 'infos', label: 'Infos', group: 'Préparer' },
  { id: 'voies', label: 'Voies', group: 'Préparer' },
  { id: 'pilotage', label: 'Pilotage', group: 'Jour J' },
]

describe('Tabs', () => {
  it('émet update:modelValue au clic sur un onglet', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs } })
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['categories'])
  })

  it('marque le bon onglet comme sélectionné', () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'voies', tabs } })
    const selected = wrapper
      .findAll('[role="tab"]')
      .find((tab) => tab.attributes('aria-selected') === 'true')
    expect(selected?.text()).toBe('Voies')
  })

  it('passe à l’onglet suivant avec la flèche droite', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs } })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['categories'])
  })

  it('boucle sur le dernier onglet avec la flèche gauche depuis le premier', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs } })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['voies'])
  })

  it('est horizontal par défaut et n’affiche pas les intertitres de groupe', () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs: grouped } })
    expect(wrapper.find('[role="tablist"]').attributes('aria-orientation')).toBe('horizontal')
    expect(wrapper.text()).not.toContain('Préparer')
  })

  it('en vertical, annonce l’orientation et range les onglets sous leurs intertitres', () => {
    const wrapper = mount(Tabs, {
      props: { modelValue: 'infos', tabs: grouped, orientation: 'vertical' },
    })
    expect(wrapper.find('[role="tablist"]').attributes('aria-orientation')).toBe('vertical')
    const headings = wrapper.findAll('[role="presentation"]').map((heading) => heading.text())
    expect(headings).toEqual(['Préparer', 'Jour J'])
    // Les intertitres ne sont pas des onglets : le compte et l'ordre restent ceux reçus.
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      'Infos',
      'Voies',
      'Pilotage',
    ])
  })

  it('les flèches haut et bas parcourent les onglets, par-dessus les intertitres', async () => {
    const wrapper = mount(Tabs, {
      props: { modelValue: 'voies', tabs: grouped, orientation: 'vertical' },
    })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['pilotage'], ['infos']])
  })

  it('déplace le focus sur l’onglet choisi au clavier', async () => {
    const wrapper = mount(Tabs, {
      props: {
        modelValue: 'infos',
        tabs,
        'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      },
      attachTo: document.body,
    })
    await wrapper.find('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(document.activeElement?.id).toBe('tab-categories')
    wrapper.unmount()
  })

  describe('pastilles (Lot 20)', () => {
    const withBadge = [
      {
        id: 'pilotage',
        label: 'Pilotage',
        badge: { count: 2, label: '2 conflits', tone: 'danger' as const },
      },
      { id: 'exports', label: 'Exports' },
    ]

    it('n’en affiche aucune par défaut', () => {
      const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs } })
      expect(wrapper.find('[role="tab"] span[aria-hidden="true"]').exists()).toBe(false)
      expect(wrapper.find('[role="tab"]').attributes('aria-label')).toBeUndefined()
    })

    it('affiche le compte, mais le tient hors du nom accessible', () => {
      const wrapper = mount(Tabs, { props: { modelValue: 'pilotage', tabs: withBadge } })
      const tab = wrapper.findAll('[role="tab"]')[0]
      expect(tab?.find('span[aria-hidden="true"]').text()).toBe('2')
      // Le sens passe par le nom accessible : « Pilotage 2 » ne veut rien dire.
      expect(tab?.attributes('aria-label')).toBe('Pilotage, 2 conflits')
    })

    it('garde le libellé en sous-chaîne du nom accessible', () => {
      // Les parcours e2e ciblent tous `getByRole('tab', { name: 'Pilotage' })`.
      const wrapper = mount(Tabs, { props: { modelValue: 'pilotage', tabs: withBadge } })
      expect(wrapper.findAll('[role="tab"]')[0]?.attributes('aria-label')).toContain('Pilotage')
    })

    it('teinte la pastille selon la gravité', () => {
      const wrapper = mount(Tabs, {
        props: {
          modelValue: 'pilotage',
          tabs: [
            {
              id: 'a',
              label: 'A',
              badge: { count: 1, label: '1 conflit', tone: 'danger' as const },
            },
            {
              id: 'b',
              label: 'B',
              badge: { count: 3, label: '3 alertes', tone: 'warning' as const },
            },
            { id: 'c', label: 'C', badge: { count: 4, label: '4 points' } },
          ],
        },
      })
      const pills = wrapper.findAll('[role="tab"] span[aria-hidden="true"]')
      expect(pills[0]?.classes()).toContain('bg-red-700')
      expect(pills[1]?.classes()).toContain('bg-amber-700')
      expect(pills[2]?.classes()).toContain('bg-gray-100')
    })
  })
})
