import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SyncStatusIndicator from './SyncStatusIndicator.vue'

describe('SyncStatusIndicator', () => {
  it('affiche le nombre de saisies en attente hors ligne', () => {
    const wrapper = mount(SyncStatusIndicator, { props: { status: 'offline', pendingCount: 4 } })
    expect(wrapper.text()).toBe('Hors ligne, 4 saisie(s) en attente')
  })

  it('affiche "À jour" une fois synchronisé', () => {
    const wrapper = mount(SyncStatusIndicator, { props: { status: 'synced' } })
    expect(wrapper.text()).toBe('À jour')
  })
})
