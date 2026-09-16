import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Badge from './Badge.vue'

describe('Badge', () => {
  it('affiche le contenu du slot', () => {
    const wrapper = mount(Badge, { slots: { default: 'Brouillon' } })
    expect(wrapper.text()).toBe('Brouillon')
  })

  it('applique la teinte demandée', () => {
    const wrapper = mount(Badge, { props: { tone: 'danger' }, slots: { default: 'Erreur' } })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['bg-red-100', 'text-red-900']))
  })
})
