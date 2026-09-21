import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { createMemoryHistory, createRouter } from 'vue-router'

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

  it('est une pilule (ADR-071)', () => {
    const wrapper = mount(Button)
    expect(wrapper.classes()).toContain('rounded-full')
  })

  it('avec `to`, rend un vrai lien qui garde la cible tactile minimale', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/login', name: 'login', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    const wrapper = mount(Button, {
      props: { to: { name: 'login' } },
      slots: { default: 'Connexion' },
      global: { plugins: [router] },
    })
    expect(wrapper.element.tagName).toBe('A')
    expect(wrapper.attributes('href')).toBe('/login')
    expect(wrapper.attributes('type')).toBeUndefined()
    expect(wrapper.classes()).toContain('min-h-12')
  })
})
