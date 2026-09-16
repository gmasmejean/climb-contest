import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FileInput from './FileInput.vue'

describe('FileInput', () => {
  it('émet le fichier choisi', async () => {
    const wrapper = mount(FileInput, { props: { modelValue: null, label: 'Fichier CSV' } })
    const file = new File(['dossard,prenom,nom'], 'competiteurs.csv', { type: 'text/csv' })
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([file])
  })

  it('affiche le nom du fichier sélectionné', () => {
    const file = new File(['a'], 'competiteurs.csv', { type: 'text/csv' })
    const wrapper = mount(FileInput, { props: { modelValue: file, label: 'Fichier CSV' } })
    expect(wrapper.text()).toContain('competiteurs.csv')
  })

  it("indique l'absence de fichier par défaut", () => {
    const wrapper = mount(FileInput, { props: { modelValue: null, label: 'Fichier CSV' } })
    expect(wrapper.text()).toContain('Aucun fichier sélectionné')
  })
})
