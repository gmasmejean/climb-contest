<script setup lang="ts">
import { inviteInputSchema, type Member, type MemberRole } from '@climbcontest/contracts'
import {
  Badge,
  Button,
  DataList,
  Modal,
  Select,
  TextField,
  useToast,
  type DataListColumn,
} from '@climbcontest/ui'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { organizationApi } from '../../api/organization'
import { currentUser } from '../../api/session'
import { DESKTOP_QUERY, useMediaQuery } from '../../composables/useMediaQuery'
import {
  ACTION_LABELS,
  CONFIRMED_ACTIONS,
  ROLE_LABELS,
  memberActions,
  statusLabel,
  type MemberAction,
} from '../../lib/members'
import { UNREACHABLE_MESSAGE, describeError } from '../../lib/network-errors'
import BrandShell from '../../components/brand/BrandShell.vue'
import OrganizerMenu from '../../components/brand/OrganizerMenu.vue'

/**
 * Membres de l'organisation (Lot 24, DECISIONS.md ADR-087). Tout membre voit la
 * liste ; seul un owner invite et agit sur les comptes. Le rôle affiché vient
 * de la session : le serveur, lui, le relit en base à chaque action.
 */

const queryClient = useQueryClient()
const { show } = useToast()
const isDesktop = useMediaQuery(DESKTOP_QUERY)

const isOwner = computed(() => currentUser.value?.role === 'owner')
const viewer = computed(() => ({ id: currentUser.value?.id ?? '', isOwner: isOwner.value }))

const { data, isPending, isError, refetch } = useQuery({
  queryKey: ['organization', 'members'],
  queryFn: organizationApi.members,
})

const refresh = () => queryClient.invalidateQueries({ queryKey: ['organization', 'members'] })

const columns = computed<DataListColumn<Member>[]>(() => [
  { key: 'name', label: 'Nom', card: 'title' },
  { key: 'email', label: 'E-mail', value: (row) => row.email },
  { key: 'role', label: 'Rôle', cellClass: 'w-36', value: (row) => ROLE_LABELS[row.role] },
  { key: 'status', label: 'Statut', cellClass: 'w-60' },
  ...(isOwner.value
    ? [
        {
          key: 'actions',
          label: 'Actions',
          card: 'actions' as const,
          labelHidden: true,
          cellClass: 'w-[26rem]',
        },
      ]
    : []),
])

// Invitation
const roleOptions = [
  { value: 'organizer', label: ROLE_LABELS.organizer },
  { value: 'owner', label: ROLE_LABELS.owner },
]
const form = reactive<{ displayName: string; email: string; role: MemberRole }>({
  displayName: '',
  email: '',
  role: 'organizer',
})
const inviteErrors = reactive<{ displayName?: string; email?: string }>({})
const inviteError = ref('')
const inviting = ref(false)

function onRoleChange(value: string): void {
  form.role = value === 'owner' ? 'owner' : 'organizer'
}

async function onInvite(): Promise<void> {
  delete inviteErrors.displayName
  delete inviteErrors.email
  inviteError.value = ''
  const parsed = inviteInputSchema.safeParse(form)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === 'displayName') inviteErrors.displayName = 'Le nom est obligatoire.'
      if (issue.path[0] === 'email') inviteErrors.email = 'Saisissez une adresse e-mail valide.'
    }
    return
  }
  inviting.value = true
  try {
    await organizationApi.invite(parsed.data)
    show(`Invitation envoyée à ${parsed.data.email}.`, 'success')
    form.displayName = ''
    form.email = ''
    form.role = 'organizer'
    await refresh()
  } catch (error) {
    inviteError.value = describeError(error)
  } finally {
    inviting.value = false
  }
}

// Actions sur un membre
const busyId = ref<string | null>(null)
const pending = ref<{ member: Member; action: MemberAction } | null>(null)

const SUCCESS: Record<MemberAction, (m: Member) => string> = {
  'resend-invitation': (m) => `Nouvelle invitation envoyée à ${m.email}.`,
  'cancel-invitation': (m) => `Invitation de ${m.displayName} annulée.`,
  'make-owner': (m) => `${m.displayName} est maintenant propriétaire.`,
  'make-organizer': (m) => `${m.displayName} est maintenant organisateur.`,
  deactivate: (m) => `Compte de ${m.displayName} désactivé.`,
  reactivate: (m) => `Compte de ${m.displayName} réactivé.`,
}

function call(member: Member, action: MemberAction): Promise<unknown> {
  switch (action) {
    case 'resend-invitation':
      return organizationApi.resendInvitation(member.id)
    case 'cancel-invitation':
      return organizationApi.cancelInvitation(member.id)
    case 'make-owner':
      return organizationApi.changeRole(member.id, { role: 'owner' })
    case 'make-organizer':
      return organizationApi.changeRole(member.id, { role: 'organizer' })
    case 'deactivate':
      return organizationApi.deactivate(member.id)
    case 'reactivate':
      return organizationApi.reactivate(member.id)
  }
}

async function run(member: Member, action: MemberAction): Promise<void> {
  busyId.value = member.id
  try {
    await call(member, action)
    show(SUCCESS[action](member), 'success')
    await refresh()
  } catch (error) {
    show(describeError(error), 'error', 8000)
  } finally {
    busyId.value = null
  }
}

function onAction(member: Member, action: MemberAction): void {
  if (CONFIRMED_ACTIONS.has(action)) {
    pending.value = { member, action }
    return
  }
  void run(member, action)
}

async function confirmPending(): Promise<void> {
  const current = pending.value
  pending.value = null
  if (current) await run(current.member, current.action)
}

const confirmTitle = computed(() =>
  pending.value?.action === 'deactivate'
    ? `Désactiver le compte de ${pending.value.member.displayName} ?`
    : `Annuler l’invitation de ${pending.value?.member.displayName ?? ''} ?`,
)
</script>

<template>
  <BrandShell width="wide">
    <template #actions>
      <OrganizerMenu />
    </template>
    <main class="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-8 lg:px-8">
      <div class="flex flex-col gap-8">
        <header class="flex flex-col gap-2">
          <RouterLink
            :to="{ name: 'competition-list' }"
            class="inline-flex min-h-12 items-center text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
          >
            ← Mes compétitions
          </RouterLink>
          <h1 class="font-display text-ink text-3xl leading-none font-bold md:text-4xl">
            Membres de l’organisation
          </h1>
          <p class="max-w-3xl text-gray-700">
            Tous les membres voient et gèrent toutes les compétitions de l’organisation. Les
            propriétaires invitent et gèrent les membres, et sont les seuls à pouvoir exporter ou
            effacer les données personnelles des compétiteurs.
          </p>
        </header>

        <section
          v-if="isOwner"
          aria-labelledby="invite-title"
          class="flex max-w-xl flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4"
        >
          <h2 id="invite-title" class="text-ink text-xl font-bold">Inviter un membre</h2>
          <p class="text-gray-700">
            La personne reçoit un lien par e-mail, valable 7 jours, pour choisir son mot de passe.
          </p>
          <form class="flex flex-col gap-4" novalidate @submit.prevent="onInvite">
            <TextField
              v-model="form.displayName"
              label="Nom"
              required
              :error="inviteErrors.displayName"
            />
            <TextField
              v-model="form.email"
              label="E-mail"
              type="email"
              autocomplete="off"
              required
              :error="inviteErrors.email"
            />
            <Select
              :model-value="form.role"
              label="Rôle"
              :options="roleOptions"
              @update:model-value="onRoleChange"
            />
            <p v-if="inviteError" role="alert" class="text-red-700">{{ inviteError }}</p>
            <div>
              <Button type="submit" :disabled="inviting">
                {{ inviting ? 'Envoi…' : 'Envoyer l’invitation' }}
              </Button>
            </div>
          </form>
        </section>
        <p v-else class="text-gray-700">Seul un propriétaire peut inviter ou gérer les membres.</p>

        <section aria-labelledby="members-title" class="flex flex-col gap-4">
          <h2 id="members-title" class="text-ink text-xl font-bold">Membres</h2>
          <p v-if="isPending" class="text-gray-600">Chargement…</p>
          <div v-else-if="isError && !data" role="alert" class="flex flex-col items-start gap-3">
            <p class="text-red-700">{{ UNREACHABLE_MESSAGE }}</p>
            <Button variant="secondary" @click="() => refetch()">Réessayer</Button>
          </div>
          <DataList
            v-else
            :rows="data ?? []"
            :columns="columns"
            :layout="isDesktop ? 'table' : 'cards'"
            :row-label="(row) => row.displayName"
            :busy="busyId !== null"
            label="Membres de l’organisation"
          >
            <template #cell-name="{ row }">
              <span class="font-medium text-gray-900">{{ row.displayName }}</span>
              <span v-if="row.id === viewer.id" class="text-gray-600"> (vous)</span>
            </template>

            <template #cell-status="{ row }">
              <span class="flex flex-col items-start gap-1">
                <Badge :tone="statusLabel(row).tone">{{ statusLabel(row).text }}</Badge>
                <span v-if="statusLabel(row).detail" class="text-sm text-gray-700">
                  {{ statusLabel(row).detail }}
                </span>
              </span>
            </template>

            <!-- Carte (< lg) : une ligne par information, les actions en dessous. -->
            <template #card="{ row }">
              <div class="flex w-full flex-col gap-2">
                <p>
                  <span class="font-medium text-gray-900">{{ row.displayName }}</span>
                  <span v-if="row.id === viewer.id" class="text-gray-600"> (vous)</span>
                </p>
                <p class="text-sm break-all text-gray-700">{{ row.email }}</p>
                <p class="flex flex-wrap items-center gap-2">
                  <span class="text-sm text-gray-700">{{ ROLE_LABELS[row.role] }}</span>
                  <Badge :tone="statusLabel(row).tone">{{ statusLabel(row).text }}</Badge>
                </p>
                <p v-if="statusLabel(row).detail" class="text-sm text-gray-700">
                  {{ statusLabel(row).detail }}
                </p>
                <div v-if="memberActions(row, viewer).length > 0" class="flex flex-wrap gap-2">
                  <Button
                    v-for="action in memberActions(row, viewer)"
                    :key="action"
                    :variant="CONFIRMED_ACTIONS.has(action) ? 'danger' : 'secondary'"
                    :disabled="busyId !== null"
                    @click="onAction(row, action)"
                  >
                    {{ ACTION_LABELS[action] }}
                  </Button>
                </div>
              </div>
            </template>

            <!-- Tableau (≥ lg) : commandes de ligne compactes, comme la corbeille (ADR-073). -->
            <template #cell-actions="{ row }">
              <span class="flex gap-1">
                <button
                  v-for="action in memberActions(row, viewer)"
                  :key="action"
                  type="button"
                  :disabled="busyId !== null"
                  class="fine:min-h-8 inline-flex min-h-12 items-center rounded-lg px-2 text-sm font-medium whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    CONFIRMED_ACTIONS.has(action)
                      ? 'text-red-700 hover:bg-red-50'
                      : 'text-blue-700 hover:bg-blue-50'
                  "
                  @click="onAction(row, action)"
                >
                  {{ ACTION_LABELS[action] }}
                </button>
              </span>
            </template>
          </DataList>
        </section>

        <Modal :open="pending !== null" :title="confirmTitle" @close="pending = null">
          <div v-if="pending" class="flex flex-col gap-4">
            <template v-if="pending.action === 'deactivate'">
              <p class="text-gray-900">
                {{ pending.member.displayName }} ne pourra plus se connecter, et ses sessions
                ouvertes sont fermées (au plus 15 minutes pour celle en cours). Ses compétitions et
                tout ce qu’il a saisi restent en place.
              </p>
              <p class="text-gray-900">Vous pourrez réactiver ce compte à tout moment.</p>
            </template>
            <template v-else>
              <p class="text-gray-900">
                Le lien envoyé à {{ pending.member.email }} ne fonctionnera plus. Vous pourrez
                l’inviter de nouveau plus tard.
              </p>
            </template>
            <div class="flex flex-wrap justify-end gap-3">
              <Button variant="secondary" @click="pending = null">
                {{ pending.action === 'deactivate' ? 'Garder le compte' : 'Garder l’invitation' }}
              </Button>
              <Button variant="danger" @click="confirmPending">
                {{ ACTION_LABELS[pending.action] }}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </main>
  </BrandShell>
</template>
