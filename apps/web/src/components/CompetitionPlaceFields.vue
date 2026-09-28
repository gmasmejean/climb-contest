<script setup lang="ts">
import type { Address, OrganizationProfile } from '@climbcontest/contracts'
import { TextField } from '@climbcontest/ui'
import { computed, useId } from 'vue'

import { organizationPlace, type PlaceChoice } from '../lib/competition-place'
import AddressAutocomplete from './AddressAutocomplete.vue'
import LocationMap from './LocationMap.vue'

/**
 * Lieu d'une compétition (Lot 26, ADR-089), à la création comme dans l'onglet
 * Infos : « Lieu de l'organisation » recopie le nom et l'adresse de la fiche,
 * « Autre lieu » ouvre la saisie. Tant que la fiche n'est pas chargée (réseau
 * lent, hors ligne), la saisie reste ouverte : rien n'attend le serveur.
 */

const props = defineProps<{
  venue: string
  address: Address | null
  choice: PlaceChoice | null
  organization: OrganizationProfile | undefined
  isOwner: boolean
  errors: { venue?: string | undefined; address?: string | undefined }
}>()

const emit = defineEmits<{
  'update:venue': [value: string]
  'update:address': [value: Address | null]
  'update:choice': [value: PlaceChoice]
}>()

const name = useId()
const place = computed(() => organizationPlace(props.organization))
const editing = computed(() => place.value === null || props.choice !== 'organization')

function choose(choice: PlaceChoice): void {
  emit('update:choice', choice)
  // Recopie la fiche actuelle — y revenir après un déménagement met le lieu à
  // jour. « Autre lieu » garde ce qui est là, pour ne retoucher qu'un détail.
  if (choice === 'organization' && place.value) {
    emit('update:venue', place.value.venue)
    emit('update:address', place.value.address)
  }
}

const optionClass =
  'flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 has-[:checked]:border-blue-700 has-[:checked]:bg-blue-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-700'
</script>

<template>
  <fieldset class="flex flex-col gap-4">
    <legend class="mb-1 text-sm font-medium text-gray-900">Lieu</legend>

    <div v-if="place" class="flex flex-col gap-2">
      <label :class="optionClass" class="border-gray-300">
        <input
          type="radio"
          :name="name"
          value="organization"
          class="mt-1 size-5 shrink-0 accent-blue-700"
          :checked="choice === 'organization'"
          @change="choose('organization')"
        />
        <span class="flex flex-col">
          <span class="font-medium text-gray-900">Lieu de l’organisation</span>
          <span class="text-sm text-gray-700">{{ place.venue }} — {{ place.address.label }}</span>
        </span>
      </label>
      <label :class="optionClass" class="border-gray-300">
        <input
          type="radio"
          :name="name"
          value="other"
          class="mt-1 size-5 shrink-0 accent-blue-700"
          :checked="choice !== 'organization'"
          @change="choose('other')"
        />
        <span class="font-medium text-gray-900">Autre lieu</span>
      </label>
    </div>

    <p
      v-else-if="organization"
      class="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700"
      data-testid="no-organization-address"
    >
      Votre organisation n’a pas encore d’adresse.
      <template v-if="isOwner">
        <RouterLink
          :to="{ name: 'organization-profile' }"
          class="text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
          >Renseignez-la dans la fiche de l’organisation</RouterLink
        >
        : elle vous sera proposée ici pour vos prochaines compétitions.
      </template>
      <template v-else>
        Un propriétaire peut la renseigner dans la fiche de l’organisation : elle sera ensuite
        proposée ici.
      </template>
    </p>

    <template v-if="editing">
      <TextField
        :model-value="venue"
        label="Nom du lieu"
        hint="Par exemple : Gymnase Jules-Verne."
        required
        :error="errors.venue"
        @update:model-value="emit('update:venue', $event)"
      />
      <AddressAutocomplete
        :model-value="address"
        label="Adresse (facultative)"
        hint="Commencez à taper, puis choisissez une proposition pour afficher une carte au public."
        :error="errors.address"
        @update:model-value="emit('update:address', $event)"
      />
      <LocationMap v-if="address && address.latitude !== null" :address="address" />
    </template>
    <p v-if="!editing && errors.venue" role="alert" class="text-sm text-red-700">
      {{ errors.venue }}
    </p>
  </fieldset>
</template>
