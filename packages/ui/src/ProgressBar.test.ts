import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ProgressBar from './ProgressBar.vue'

describe('ProgressBar', () => {
  it('affiche le compte en clair à côté de la barre', () => {
    const wrapper = mount(ProgressBar, { props: { value: 12, max: 30, label: 'Voie 3' } })
    expect(wrapper.text()).toContain('12 / 30')
    expect(wrapper.text()).toContain('Voie 3')
  })

  it('annonce sa valeur et son échelle', () => {
    const wrapper = mount(ProgressBar, { props: { value: 12, max: 30, label: 'Voie 3' } })
    const bar = wrapper.get('[role="progressbar"]')
    expect(bar.attributes('aria-label')).toBe('Voie 3')
    expect(bar.attributes('aria-valuenow')).toBe('12')
    expect(bar.attributes('aria-valuemin')).toBe('0')
    expect(bar.attributes('aria-valuemax')).toBe('30')
    expect(bar.attributes('aria-valuetext')).toBe('12 sur 30')
  })

  it('remplit la barre au prorata', () => {
    const wrapper = mount(ProgressBar, { props: { value: 3, max: 4, label: 'Voie 1' } })
    expect(wrapper.get('[role="progressbar"] > div').attributes('style')).toContain('width: 75%')
  })

  it('passe au vert une fois tout le monde passé', () => {
    const partial = mount(ProgressBar, { props: { value: 3, max: 4, label: 'Voie 1' } })
    const complete = mount(ProgressBar, { props: { value: 4, max: 4, label: 'Voie 1' } })
    expect(partial.get('[role="progressbar"] > div').classes()).toContain('bg-blue-700')
    expect(complete.get('[role="progressbar"] > div').classes()).toContain('bg-green-700')
  })

  it('borne le remplissage sans mentir sur le compte', () => {
    // Plus de saisies que d'attendus (un compétiteur ajouté après coup) : la
    // barre sature, le texte dit la vérité.
    const wrapper = mount(ProgressBar, { props: { value: 5, max: 4, label: 'Voie 1' } })
    expect(wrapper.get('[role="progressbar"] > div').attributes('style')).toContain('width: 100%')
    expect(wrapper.text()).toContain('5 / 4')
  })

  it('reste indéterminée quand rien n’est attendu', () => {
    const wrapper = mount(ProgressBar, { props: { value: 0, max: 0, label: 'Voie 1' } })
    const bar = wrapper.get('[role="progressbar"]')
    expect(bar.attributes('aria-valuenow')).toBeUndefined()
    expect(bar.attributes('aria-valuemax')).toBeUndefined()
    expect(bar.attributes('aria-valuetext')).toBe('aucun passage attendu')
    expect(wrapper.get('[role="progressbar"] > div').attributes('style')).toContain('width: 0%')
  })

  it('peut masquer le libellé sans le retirer du nom accessible', () => {
    const wrapper = mount(ProgressBar, {
      props: { value: 1, max: 2, label: 'Voie 1', labelHidden: true },
    })
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toBe('Voie 1')
    expect(wrapper.find('.sr-only').text()).toBe('Voie 1')
  })
})
