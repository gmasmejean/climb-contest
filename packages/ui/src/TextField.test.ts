import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TextField from './TextField.vue'

describe('TextField', () => {
  it("émet update:modelValue à la saisie", async () => {
    const wrapper = mount(TextField, { props: { modelValue: '', label: 'E-mail' } })
    const input = wrapper.find('input')
    await input.setValue('alex@club-demo.test')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['alex@club-demo.test'])
  })

  it('associe le message d\'erreur au champ via aria-describedby', () => {
    const wrapper = mount(TextField, {
      props: { modelValue: '', label: 'E-mail', error: 'E-mail invalide' },
    })
    const input = wrapper.find('input')
    const describedBy = input.attributes('aria-describedby')
    expect(describedBy).toBeDefined()
    expect(wrapper.find(`#${describedBy}`).text()).toBe('E-mail invalide')
    expect(input.attributes('aria-invalid')).toBe('true')
  })
})
