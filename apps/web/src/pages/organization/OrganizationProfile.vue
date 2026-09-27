<script setup lang="ts">
import { updateOrganizationInputSchema, type OrganizationProfile } from '@climbcontest/contracts'
import { Button, Select, TextArea, TextField, useToast } from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref, watch } from 'vue'

import { organizationApi } from '../../api/organization'
import { currentUser } from '../../api/session'
import AddressAutocomplete from '../../components/AddressAutocomplete.vue'
import BrandShell from '../../components/brand/BrandShell.vue'
import OrganizerMenu from '../../components/brand/OrganizerMenu.vue'
import LocationMap from '../../components/LocationMap.vue'
import OrganizationCard from '../../components/OrganizationCard.vue'
import { describeError, UNREACHABLE_MESSAGE } from '../../lib/network-errors'
import {
  DESCRIPTION_MAX_LENGTH,
  formFromProfile,
  inputFromForm,
  ORGANIZATION_TYPE_OPTIONS,
  PUBLIC_CONTACT_WARNING,
  publicView,
  type OrganizationForm,
} from '../../lib/organization-profile'

/**
 * Fiche de l'organisation (Lot 25, DECISIONS.md ADR-088). L'owner la modifie ;
 * un organizer la voit telle que le public la verra. Le rôle affiché vient de
 * la session : le serveur, lui, le relit en base à l'enregistrement.
 */

const queryClient = useQueryClient()
const { show } = useToast()

const isOwner = computed(() => currentUser.value?.role === 'owner')

const { data, isPending, isError, refetch } = useQuery({
  queryKey: ['organization', 'profile'],
  queryFn: organizationApi.profile,
})

const form = reactive<OrganizationForm>({
  name: '',
  type: 'club',
  description: '',
  contactEmail: '',
  contactPhone: '',
  websiteUrl: '',
  address: null,
})
type FieldErrors = Partial<Record<keyof OrganizationForm, string>>
const errors = reactive<FieldErrors>({})
const formError = ref('')
const saving = ref(false)

function load(profile: OrganizationProfile): void {
  Object.assign(form, formFromProfile(profile))
}

// Rempli une fois, à l'arrivée de la fiche : un rechargement en arrière-plan
// n'efface pas une saisie en cours.
let loaded = false
watch(
  data,
  (profile) => {
    if (profile && !loaded) {
      loaded = true
      load(profile)
    }
  },
  { immediate: true },
)

function isField(key: unknown): key is keyof OrganizationForm {
  return typeof key === 'string' && key in form
}

async function onSubmit(): Promise<void> {
  for (const key of Object.keys(errors)) {
    if (isField(key)) delete errors[key]
  }
  formError.value = ''
  const parsed = updateOrganizationInputSchema.safeParse(inputFromForm(form))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (isField(field) && !errors[field]) errors[field] = issue.message
    }
    formError.value = 'Corrigez les champs signalés, puis enregistrez de nouveau.'
    return
  }
  saving.value = true
  try {
    const saved = await organizationApi.updateProfile(parsed.data)
    queryClient.setQueryData(['organization', 'profile'], saved)
    load(saved)
    show('Fiche enregistrée.', 'success')
  } catch (error) {
    formError.value = describeError(error)
  } finally {
    saving.value = false
  }
}

const preview = computed(() => form.address)
</script>

<template>
  <BrandShell>
    <template #actions>
      <OrganizerMenu />
    </template>
    <main class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8">
      <header class="flex flex-col gap-2">
        <RouterLink
          :to="{ name: 'competition-list' }"
          class="inline-flex min-h-12 items-center self-start text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
        >
          ← Mes compétitions
        </RouterLink>
        <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
          Fiche de l’organisation
        </h1>
        <p class="text-gray-700">
          Elle s’affiche sur la page publique de chacune de vos compétitions, sous le classement.
        </p>
      </header>

      <p v-if="isPending" class="text-gray-600">Chargement…</p>
      <div v-else-if="isError && !data" role="alert" class="flex flex-col items-start gap-3">
        <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
        <Button variant="secondary" @click="() => refetch()">Réessayer</Button>
      </div>

      <form v-else-if="isOwner" class="flex flex-col gap-8" novalidate @submit.prevent="onSubmit">
        <section aria-labelledby="identity-title" class="flex flex-col gap-4">
          <h2 id="identity-title" class="text-ink text-xl font-bold">L’organisation</h2>
          <TextField v-model="form.name" label="Nom" required :error="errors.name" />
          <Select
            v-model="form.type"
            label="Type"
            :options="ORGANIZATION_TYPE_OPTIONS"
            :error="errors.type"
          />
          <TextArea
            v-model="form.description"
            label="Description"
            hint="Ce que le public doit savoir : l’activité, les horaires, l’accès…"
            :maxlength="DESCRIPTION_MAX_LENGTH"
            :error="errors.description"
          />
        </section>

        <section aria-labelledby="place-title" class="flex flex-col gap-4">
          <h2 id="place-title" class="text-ink text-xl font-bold">Lieu</h2>
          <AddressAutocomplete
            v-model="form.address"
            label="Adresse"
            hint="Commencez à taper, puis choisissez une proposition pour afficher une carte."
            :error="errors.address"
          />
          <LocationMap v-if="preview && preview.latitude !== null" :address="preview" />
        </section>

        <section aria-labelledby="contact-title" class="flex flex-col gap-4">
          <h2 id="contact-title" class="text-ink text-xl font-bold">Contact public</h2>
          <p
            class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900"
            data-testid="public-contact-warning"
          >
            {{ PUBLIC_CONTACT_WARNING }}
          </p>
          <TextField
            v-model="form.contactEmail"
            label="E-mail"
            type="email"
            autocomplete="off"
            :error="errors.contactEmail"
          />
          <TextField
            v-model="form.contactPhone"
            label="Téléphone"
            type="tel"
            autocomplete="off"
            :error="errors.contactPhone"
          />
          <TextField
            v-model="form.websiteUrl"
            label="Site web"
            type="url"
            autocomplete="off"
            hint="Par exemple www.mon-club.fr : https:// est ajouté s’il manque."
            :error="errors.websiteUrl"
          />
        </section>

        <p v-if="formError" role="alert" class="text-red-700">{{ formError }}</p>
        <div>
          <Button type="submit" :disabled="saving">
            {{ saving ? 'Enregistrement…' : 'Enregistrer la fiche' }}
          </Button>
        </div>
      </form>

      <template v-else-if="data">
        <p class="text-gray-700">
          Voici la fiche telle que le public la voit. Seul un propriétaire peut la modifier.
        </p>
        <OrganizationCard :organization="publicView(data)" />
      </template>
    </main>
  </BrandShell>
</template>
