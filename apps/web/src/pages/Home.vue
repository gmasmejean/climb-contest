<script setup lang="ts">
import { Button } from '@climbcontest/ui'
import { useRouter } from 'vue-router'

import { apiFetch } from '../api/client'
import { clearSession, currentUser } from '../api/session'

const router = useRouter()

async function onLogout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' })
  clearSession()
  await router.push({ name: 'login' })
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-lg flex-col gap-6 px-4 py-8">
    <header class="flex items-center justify-between">
      <p class="text-lg text-gray-900">
        Bonjour, <strong>{{ currentUser?.displayName }}</strong>
      </p>
      <Button variant="secondary" @click="onLogout">Se déconnecter</Button>
    </header>
  </main>
</template>
