<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { onBeforeUnmount, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'

import { apiFetch } from '../../api/client'
import { clearSession, currentUser } from '../../api/session'

/**
 * Menu de l'organisateur connecté : seul point d'accès à la déconnexion sur
 * les pages `/competitions*` (`/` n'est plus la destination après connexion —
 * voir `Login.vue`), donc présent dans l'en-tête de chacune d'elles.
 */

const router = useRouter()
const open = ref(false)
const menuId = useId()
const root = ref<HTMLElement | null>(null)

function close(): void {
  open.value = false
}

function onDocumentClick(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('click', onDocumentClick)
    document.removeEventListener('keydown', onKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

async function onLogout(): Promise<void> {
  close()
  await apiFetch('/auth/logout', { method: 'POST' })
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <div v-if="currentUser" ref="root" class="relative">
    <Button
      variant="secondary"
      aria-label="Menu"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-controls="menuId"
      @click="open = !open"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
        focusable="false"
        class="size-5"
      >
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </svg>
    </Button>

    <div
      v-if="open"
      :id="menuId"
      role="menu"
      class="ring-gray-200/80 absolute top-full right-0 z-20 mt-2 w-56 rounded-lg bg-white p-2 shadow-lg ring-1"
    >
      <p class="text-ink truncate px-3 pt-1 pb-2 text-sm font-medium">
        {{ currentUser.displayName }}
      </p>
      <RouterLink
        :to="{ name: 'home' }"
        role="menuitem"
        class="flex min-h-12 items-center rounded-md px-3 text-base hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
        @click="close"
      >
        Accueil
      </RouterLink>
      <RouterLink
        :to="{ name: 'competition-list' }"
        role="menuitem"
        class="flex min-h-12 items-center rounded-md px-3 text-base hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
        @click="close"
      >
        Mes compétitions
      </RouterLink>
      <RouterLink
        :to="{ name: 'organization-members' }"
        role="menuitem"
        class="flex min-h-12 items-center rounded-md px-3 text-base hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
        @click="close"
      >
        Membres de l’organisation
      </RouterLink>
      <button
        type="button"
        role="menuitem"
        class="flex min-h-12 w-full items-center rounded-md px-3 text-left text-base hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700"
        @click="onLogout"
      >
        Se déconnecter
      </button>
    </div>
  </div>
</template>
