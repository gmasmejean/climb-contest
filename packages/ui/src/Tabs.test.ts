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
})
