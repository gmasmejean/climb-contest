import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Tabs from './Tabs.vue'

const tabs = [
  { id: 'infos', label: 'Infos' },
  { id: 'categories', label: 'Catégories' },
  { id: 'voies', label: 'Voies' },
]

describe('Tabs', () => {
  it('émet update:modelValue au clic sur un onglet', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'infos', tabs } })
    await wrapper.findAll('[role="tab"]')[1]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['categories'])
  })

  it('marque le bon onglet comme sélectionné', () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'voies', tabs } })
    const selected = wrapper.findAll('[role="tab"]').find((tab) => tab.attributes('aria-selected') === 'true')
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
})
