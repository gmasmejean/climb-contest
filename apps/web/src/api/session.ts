import type { Organizer } from '@climbcontest/contracts'
import { ref } from 'vue'

export const accessToken = ref<string | null>(null)
export const currentUser = ref<Organizer | null>(null)

export function setSession(token: string, user: Organizer): void {
  accessToken.value = token
  currentUser.value = user
}

export function clearSession(): void {
  accessToken.value = null
  currentUser.value = null
}
