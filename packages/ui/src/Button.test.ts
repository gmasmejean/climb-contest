import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Button from './Button.vue'

describe('Button', () => {
  it('affiche le contenu du slot et respecte la cible tactile minimale', () => {
    const wrapper = mount(Button, { slots: { default: 'Valider' } })
    expect(wrapper.text()).toBe('Valider')
    expect(wrapper.classes()).toContain('min-h-12')
    expect(wrapper.classes()).toContain('min-w-12')
  })

  it('désactive le bouton quand disabled est vrai', () => {
    const wrapper = mount(Button, { props: { disabled: true } })
    expect(wrapper.attributes('disabled')).toBeDefined()
  })

  it('utilise le type submit demandé', () => {
    const wrapper = mount(Button, { props: { type: 'submit' } })
    expect(wrapper.attributes('type')).toBe('submit')
  })
})
