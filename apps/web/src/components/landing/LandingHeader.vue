<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { useRouter } from 'vue-router'

import { apiFetch } from '../../api/client'
import { clearSession, currentUser } from '../../api/session'
import BrandLogo from '../brand/BrandLogo.vue'
import RoleIcon from './RoleIcon.vue'

const router = useRouter()

async function onLogout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' })
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <header class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <BrandLogo />

    <!--
      État connecté : `/` reste publique et restaure la session pour cet
      en-tête (ADR-070), mais n'est plus la destination après connexion
      depuis ADR-080 — c'est `OrganizerMenu.vue` (pages `/competitions*`)
      qui porte désormais « Se déconnecter » au quotidien. Quelques tests
      e2e cliquent encore ce lien après une navigation manuelle vers `/` ;
      ne pas le renommer sans vérifier `e2e/landing.spec.ts`.
    -->
    <div v-if="currentUser" class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p class="text-ink max-w-[12rem] truncate text-base">
        <span class="sr-only">Connecté·e : </span>{{ currentUser.displayName }}
      </p>
      <Button :to="{ name: 'competition-list' }">Mes compétitions</Button>
      <Button variant="secondary" @click="onLogout">Se déconnecter</Button>
    </div>

    <Button v-else variant="glass" :to="{ name: 'login' }">
      <RoleIcon name="user" class="size-5" />
      <span class="flex flex-col items-start leading-tight">
        <span class="text-sm font-bold">Espace organisateur</span>
        <span class="text-xs font-normal">Connexion · Inscription</span>
      </span>
    </Button>
  </header>
</template>
