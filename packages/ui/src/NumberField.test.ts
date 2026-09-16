import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NumberField from './NumberField.vue'

describe('NumberField', () => {
  it('émet un nombre à la saisie', async () => {
    const wrapper = mount(NumberField, { props: { modelValue: null, label: 'Dossard' } })
    const input = wrapper.find('input')
    await input.setValue('47')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([47])
  })

  it('émet null quand le champ est vidé', async () => {
    const wrapper = mount(NumberField, { props: { modelValue: 47, label: 'Dossard' } })
    const input = wrapper.find('input')
    await input.setValue('')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([null])
  })

  it('associe le message d’erreur au champ via aria-describedby', () => {
    const wrapper = mount(NumberField, {
      props: { modelValue: null, label: 'Prises', error: 'Doit être positif' },
    })
    const input = wrapper.find('input')
    const describedBy = input.attributes('aria-describedby')
    expect(describedBy).toBeDefined()
    expect(wrapper.find(`#${describedBy}`).text()).toBe('Doit être positif')
    expect(input.attributes('aria-invalid')).toBe('true')
  })
})
