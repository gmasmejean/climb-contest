import type { PublicOrganization } from '@climbcontest/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import OrganizationCard from './OrganizationCard.vue'

vi.mock('../lib/leaflet-map', () => ({ createLocationMap: vi.fn(() => ({ destroy: vi.fn() })) }))

const full: PublicOrganization = {
  name: 'Club Roc Amiens',
  type: 'gym',
  description: 'Salle de bloc et de difficulté.\nOuverte 7 jours sur 7.',
  contactEmail: 'contact@club-roc.test',
  contactPhone: '03 22 00 00 00',
  websiteUrl: 'https://www.club-roc.test/',
  address: {
    label: '8 Boulevard du Port 80000 Amiens',
    postcode: '80000',
    city: 'Amiens',
    latitude: 49.897442,
    longitude: 2.290084,
  },
}

describe('OrganizationCard', () => {
  it('montre le nom, le type, la description, l’adresse et le contact', () => {
    const wrapper = mount(OrganizationCard, {
      props: { organization: full, eyebrow: 'Organisé par' },
    })
    expect(wrapper.get('h2').text()).toBe('Club Roc Amiens')
    expect(wrapper.text()).toContain('Organisé par')
    expect(wrapper.text()).toContain('Salle')
    expect(wrapper.text()).toContain('Ouverte 7 jours sur 7.')
    expect(wrapper.text()).toContain('8 Boulevard du Port 80000 Amiens')
    const hrefs = wrapper.findAll('ul a').map((link) => link.attributes('href'))
    expect(hrefs).toEqual([
      'mailto:contact@club-roc.test',
      'tel:0322000000',
      'https://www.club-roc.test/',
    ])
    expect(wrapper.text()).toContain('www.club-roc.test')
  })

  it('une fiche vide ne montre que le nom et le type', () => {
    const wrapper = mount(OrganizationCard, {
      props: {
        organization: {
          ...full,
          description: null,
          contactEmail: null,
          contactPhone: null,
          websiteUrl: null,
          address: null,
        },
      },
    })
    expect(wrapper.find('ul').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Itinéraire')
    expect(wrapper.text()).toContain('Club Roc Amiens')
  })

  it('n’affiche pas un lien de site qui ne serait pas http(s)', () => {
    const wrapper = mount(OrganizationCard, {
      props: { organization: { ...full, websiteUrl: 'javascript:alert(1)' } },
    })
    expect(
      wrapper.findAll('a').some((link) => link.attributes('href')?.startsWith('javascript')),
    ).toBe(false)
  })
})
