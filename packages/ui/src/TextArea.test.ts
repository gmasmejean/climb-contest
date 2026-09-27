import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TextArea from './TextArea.vue'

describe('TextArea', () => {
  it('émet update:modelValue à la saisie', async () => {
    const wrapper = mount(TextArea, { props: { modelValue: '', label: 'Description' } })
    await wrapper.find('textarea').setValue('Salle de bloc.')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['Salle de bloc.'])
  })

  it('compte les caractères quand une limite est donnée, et relie le compteur au champ', () => {
    const wrapper = mount(TextArea, {
      props: { modelValue: 'a'.repeat(1500), label: 'Description', maxlength: 2000 },
    })
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('maxlength')).toBe('2000')
    const counterId = textarea.attributes('aria-describedby')
    expect(counterId).toBeDefined()
    expect(wrapper.find(`#${counterId}`).text()).toMatch(/1\s500 \/ 2\s000 caractères/)
  })

  it('associe le message d’erreur au champ', () => {
    const wrapper = mount(TextArea, {
      props: { modelValue: '', label: 'Description', error: 'Trop long' },
    })
    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(wrapper.find(`#${textarea.attributes('aria-describedby')}`).text()).toBe('Trop long')
  })
})
