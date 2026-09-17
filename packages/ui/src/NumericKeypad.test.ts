import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NumericKeypad from './NumericKeypad.vue'

function digitButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)
}

describe('NumericKeypad', () => {
  it('respecte la cible tactile minimale', () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: null, min: 1, max: 40 } })
    const digit = digitButton(wrapper, '1')
    expect(digit?.classes()).toContain('min-h-16')
    expect(digit?.classes()).toContain('min-w-16')
  })

  it('compose une valeur en bornes basses (1)', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: null, min: 1, max: 40 } })
    await digitButton(wrapper, '1')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([1])
  })

  it('compose une valeur en bornes hautes (max)', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: null, min: 1, max: 40 } })
    await digitButton(wrapper, '4')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([4])
    await wrapper.setProps({ modelValue: 4 })
    await digitButton(wrapper, '0')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[1]).toEqual([40])
  })

  it('refuse une frappe qui dépasserait max', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: 4, min: 1, max: 40 } })
    // 4 -> "41" dépasserait 40 : la frappe est ignorée, aucun événement émis.
    await digitButton(wrapper, '1')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('refuse un zéro en tête', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: null, min: 1, max: 40 } })
    await digitButton(wrapper, '0')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('efface le dernier chiffre avec le retour arrière', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: 25, min: 1, max: 40 } })
    await digitButton(wrapper, '⌫')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([2])
  })

  it('revient à `null` en effaçant le dernier chiffre restant', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: 2, min: 1, max: 40 } })
    await digitButton(wrapper, '⌫')?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([null])
  })

  it('le bouton « Effacer » remet la valeur à `null`', async () => {
    const wrapper = mount(NumericKeypad, { props: { modelValue: 25, min: 1, max: 40 } })
    await wrapper.find('button.text-blue-700').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([null])
  })

  it('désactive tous les boutons quand `disabled` est vrai', () => {
    const wrapper = mount(NumericKeypad, {
      props: { modelValue: null, min: 1, max: 40, disabled: true },
    })
    const digit = digitButton(wrapper, '1')
    expect(digit?.attributes('disabled')).toBeDefined()
  })
})
