# TODO.md — repéré en chemin, remis à plus tard

Une entrée par idée. Ce n'est pas une todo-list de tâches en cours — juste ce
qu'on a choisi de ne pas faire maintenant, et pourquoi.

## Depuis le Lot 0

- **Ordre de passage et isolement en demi-finale/finale** — non modélisé en
  v1, géré sur papier par l'organisateur (ADR-006, `DECISIONS.md`). Extension
  possible post-v1 si le format phases est utilisé pour une vraie finale
  fédérale.

## Depuis le Lot 1

- **Validation admin des créations de club/organisateur.** L'inscription est
  ouverte à tous en v1 (voir ADR-017). À terme, une zone d'administration
  devra permettre de valider/révoquer des clubs et des comptes créés en
  abus. Pas dans le périmètre de ce lot.
- **Zone publique de recherche de club/compétition.** Idée notée pendant le
  cadrage du Lot 1 : un visiteur pourrait chercher un club ou une compétition
  sans lien direct. Aucun lot actuel ne le prévoit.
- **Écran d'acceptation d'invitation.** La route API (`POST
/auth/invitations/accept`) existe et est testée, mais `apps/web` n'a pas
  d'écran pour la consommer ce lot (contrainte des trois écrans de ce lot).
  En pratique, un organisateur invité ne peut activer son compte que via un
  appel API direct tant que cet écran n'existe pas.
- **Limitation de débit en mémoire, par processus.** `hono-rate-limiter` avec
  un `MemoryStore` suffit pour une seule instance API. Si l'API tourne un
  jour derrière plusieurs workers/instances (cf. ADR-014 sur `LISTEN/NOTIFY`
  pour le même problème côté SSE), il faudra un store partagé.
- **Image Docker de production non optimisée.** `infra/docker/api.Dockerfile`
  copie le `node_modules` complet du monorepo (avec les devDependencies)
  dans l'image finale, par simplicité. Un élagage propre (`pnpm deploy`, ou
  une étape finale distincte par service) réduirait significativement sa
  taille — pas fait ce lot.
- **Génération de jetons aléatoires (`randomToken`) avec un léger biais
  modulo.** L'encodage base62 par octet (`byte % 62`) introduit un biais
  statistique négligeable pour un jeton de vérification e-mail, mais à
  corriger (échantillonnage par rejet) avant que les jetons d'accès juge du
  Lot 4 ne s'appuient sur le même mécanisme en production.
- **Le test e2e Playwright ne tourne pas en CI.** Il suppose la pile Docker
  complète démarrée et seedée (`e2e/README.md`) — pas encore automatisé dans
  `.github/workflows/ci.yml`, qui ne construit pas les images pour l'instant.
- **CI sans vérification de formatage.** `prettier --check` existe comme
  script (`pnpm format:check`) mais n'est pas encore une étape de
  `.github/workflows/ci.yml` — le Lot 1 de `ROADMAP.md` n'énumère pas cette
  étape, donc pas ajoutée sans te le demander.

## Depuis le Lot 2

- ~~`ConfigSchema.parse` (packages/scoring) lève au lieu de renvoyer un
  résultat `safeParse`-like.~~ Résolu au Lot 3 : `POST /competitions`
  enveloppe l'appel à `engine.configSchema.parse` dans un `try/catch`
  explicite (`apps/api/src/routes/competitions.ts`), converti en
  `problem()` 400. Pas de changement dans `packages/scoring` lui-même.

## Depuis le Lot 3

- **Contrôle « prêt à démarrer ? » incomplet tant que le Lot 4 n'existe
  pas.** `GET /competitions/:id/readiness` (`apps/api/src/lib/readiness.ts`)
  ne couvre que 4 des 5 conditions listées par ROADMAP.md Lot 3 : « voie
  sans juge assigné » est volontairement absente, les juges n'existant pas
  avant le Lot 4. Le Lot 4 devra ajouter un 5ᵉ `ReadinessCheck` (id
  `route_without_judge` par exemple) — la structure (`checks: []`) et
  l'écran (`ReadinessTab.vue`) sont déjà conçus pour l'accueillir sans
  réécriture.
- **`ffme-difficulty-2026ConfigSchema` exige `routesCounted` même en
  format phases**, où ce nombre n'a aucun sens métier (voir ADR-023).
  L'API fournit une valeur neutre par défaut plutôt que de modifier
  `packages/scoring` (hors périmètre de ce lot). Si cette friction devient
  gênante pour un moteur futur, envisager de rendre ce champ de config
  optionnel/ignoré selon le format, dans `packages/scoring`.
- **Pas de pagination côté serveur** sur `GET .../competitors`, `.../routes`
  ni `.../categories` — écran organisateur pensé pour l'échelle d'une
  compétition de club (dizaines à ~150 compétiteurs). À revoir si une
  compétition dépasse largement cette taille.
- **Pas de suppression pour les voies et les tours** (seulement création/
  édition/réordonnancement) — non demandé par ROADMAP.md Lot 3. Si un
  besoin apparaît, appliquer la même protection que les catégories (bloquer
  si un `ascent` existe, ADR-004) plutôt que de permettre une suppression
  libre.
