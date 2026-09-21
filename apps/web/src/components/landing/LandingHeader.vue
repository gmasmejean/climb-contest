<script setup lang="ts">
import { useRouter } from 'vue-router'

import { apiFetch } from '../../api/client'
import { clearSession, currentUser } from '../../api/session'
import BrandLogo from './BrandLogo.vue'
import LandingPill from './LandingPill.vue'
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
      État connecté : `/` reste la destination après connexion (ADR-070). Le
      libellé « Mes compétitions » est un contrat : une dizaine de tests e2e
      cliquent `getByRole('link', { name: 'Mes compétitions' })` juste après
      s'être connectés. Ne pas le renommer sans les mettre à jour.
    -->
    <div v-if="currentUser" class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p class="text-ink max-w-[12rem] truncate text-base">
        <span class="sr-only">Connecté·e : </span>{{ currentUser.displayName }}
      </p>
      <LandingPill :to="{ name: 'competition-list' }">Mes compétitions</LandingPill>
      <LandingPill variant="outline" @click="onLogout">Se déconnecter</LandingPill>
    </div>

    <LandingPill v-else :to="{ name: 'login' }">
      <RoleIcon name="user" class="size-5" />
      <span class="flex flex-col items-start leading-tight">
        <span class="text-sm font-bold">Espace organisateur</span>
        <span class="text-xs font-normal">Connexion · Inscription</span>
      </span>
    </LandingPill>
  </header>
</template>
