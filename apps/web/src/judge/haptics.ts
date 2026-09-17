/**
 * SPEC.md § 6.5 : retour haptique à la validation d'une saisie. L'optional
 * chaining suffit comme repli silencieux (iOS Safari n'implémente pas
 * `navigator.vibrate`) — jamais d'erreur, jamais de vérification explicite.
 */
export function vibrateOnConfirm(): void {
  navigator.vibrate?.(200)
}
