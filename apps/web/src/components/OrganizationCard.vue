<script setup lang="ts">
import { isHttpUrl, type PublicOrganization } from '@climbcontest/contracts'
import { Badge } from '@climbcontest/ui'
import { computed, useId } from 'vue'

import { ORGANIZATION_TYPE_LABELS, telHref } from '../lib/organization-profile'
import LocationMap from './LocationMap.vue'

/**
 * La fiche de l'organisation telle que le public la voit (ADR-088) : encart de
 * la page publique d'une compétition, et aperçu pour les organizers.
 */

const props = withDefaults(
  defineProps<{
    organization: PublicOrganization
    eyebrow?: string | undefined
    /** ADR-089 : la compétition a lieu chez l'organisation, sa carte est déjà affichée. */
    hideLocation?: boolean
  }>(),
  { eyebrow: undefined, hideLocation: false },
)

const titleId = useId()

// Le contrat n'accepte que du https en saisie ; on revérifie à l'affichage,
// comme pour les vidéos, plutôt que de faire confiance à ce qui est stocké.
const website = computed(() => {
  const url = props.organization.websiteUrl
  if (!isHttpUrl(url)) return null
  return { href: url, text: url.replace(/^https?:\/\//, '').replace(/\/$/, '') }
})
const hasContact = computed(
  () =>
    props.organization.contactEmail !== null ||
    props.organization.contactPhone !== null ||
    website.value !== null,
)

const linkClass =
  'inline-flex min-h-12 items-center break-all text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700'
</script>

<template>
  <section
    :aria-labelledby="titleId"
    class="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
    data-testid="organization-card"
  >
    <header class="flex flex-col gap-2">
      <p v-if="eyebrow" class="text-sm text-gray-600">{{ eyebrow }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <h2 :id="titleId" class="text-ink text-xl font-bold">{{ organization.name }}</h2>
        <Badge>{{ ORGANIZATION_TYPE_LABELS[organization.type] }}</Badge>
      </div>
    </header>

    <p v-if="organization.description" class="whitespace-pre-line text-gray-800">
      {{ organization.description }}
    </p>

    <LocationMap v-if="organization.address && !hideLocation" :address="organization.address" />

    <ul v-if="hasContact" class="flex flex-col" aria-label="Contact">
      <li v-if="organization.contactEmail">
        <a :href="`mailto:${organization.contactEmail}`" :class="linkClass">
          {{ organization.contactEmail }}
        </a>
      </li>
      <li v-if="organization.contactPhone">
        <a :href="telHref(organization.contactPhone)" :class="linkClass">
          {{ organization.contactPhone }}
        </a>
      </li>
      <li v-if="website">
        <a :href="website.href" target="_blank" rel="noopener noreferrer" :class="linkClass">
          {{ website.text }}<span class="sr-only"> (nouvelle fenêtre)</span>
        </a>
      </li>
    </ul>
  </section>
</template>
