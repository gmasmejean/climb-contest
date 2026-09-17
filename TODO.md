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
- ~~Génération de jetons aléatoires (`randomToken`) avec un léger biais
  modulo.~~ Résolu au Lot 4 : encodage base62 par échantillonnage par rejet
  (`packages/db/src/crypto.ts`), avant que les jetons d'accès juge n'en
  dépendent — voir DECISIONS.md ADR-026.
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

- ~~Contrôle « prêt à démarrer ? » incomplet tant que le Lot 4 n'existe
  pas.~~ Résolu au Lot 4 : 5ᵉ `ReadinessCheck` `route_without_judge` ajouté
  (`apps/api/src/lib/readiness.ts`).
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

## Depuis le Lot 4

- **Pas de bascule « ajouter un PIN » sur un juge créé sans PIN**, ni
  l'inverse — seule la régénération d'un PIN déjà existant est possible
  (DECISIONS.md ADR-026, décision 2, tranchée explicitement avec
  l'utilisateur). Si le besoin apparaît (ex. un juge exposé publiquement a
  finalement besoin d'un PIN en cours d'événement), prévoir une action
  dédiée plutôt que de réutiliser « régénérer ».
- ~~La planche de QR codes ne peut inclure en encart individuel que les
  juges créés dans la session en cours~~ Résolu pour le cas par défaut par
  ADR-027 : un juge dont le jeton est stocké en clair est inclus
  automatiquement. Reste vrai uniquement pour une compétition avec
  `judgeCredentialsStored` désactivé (ADR-026, décision 5) — `JudgesTab.vue`
  prévient alors l'organisateur, mais rien n'automatise un rappel « pensez à
  télécharger la planche avant de recharger la page » pour ce cas restant.
- **La page QR publique de la planche pointe vers `/c/<slug>`, qui n'existe
  pas avant le Lot 7.** Le lien est correct (le `public_slug` existe depuis
  le Lot 1) mais mène à un 404 tant que la page publique n'est pas
  construite — assumé, cohérent avec « un lot à la fois ».
- **`packages/db/src/db.test.ts` et les fichiers `apps/api/src/**/*.test.ts`
  démarrent chacun leur propre conteneur Postgres (testcontainers).** Sur
  cette machine de développement (Podman, socket utilisateur), lancer
  `pnpm test` depuis la racine (parallélisme total de Turbo + workers
  Vitest) fait parfois échouer un ou deux fichiers avec `Log stream ended`
  quand une dizaine de conteneurs démarrent simultanément — un problème de
  ressources locales, pas un bug : chaque suite repasse au vert isolément
  (`pnpm test` dans le paquet concerné, ou `vitest run --no-file-parallelism`).
  Pas vérifié si `ubuntu-latest` (CI GitHub Actions, Docker natif) est
  concerné — Lot 4 ajoute 4 fichiers de test à `apps/api` avec conteneur
  dédié chacun (10 au total dans ce paquet), ce qui augmente la charge
  simultanée. À surveiller au prochain lot si la CI devient flaky.
- **`judgeCredentialsStored` (ADR-027) est un réglage par compétition, pas
  par juge.** Un club qui veut conserver le clair pour la plupart de ses
  juges mais pas pour un juge particulier (ex. accès affiché publiquement)
  doit gérer ça à la main (créer ce juge pendant que le réglage est
  désactivé). Tranché ainsi avec l'utilisateur — pas un oubli, mais noté si
  le besoin d'un réglage plus fin apparaît.
- **Pas de test e2e Playwright pour le flux « voir l'accès » / e-mail
  juge**, contrairement à Lot 1 (`e2e/login.spec.ts`) — couvert par les
  tests d'intégration API (`judges.test.ts`) et une vérification manuelle en
  navigateur pendant la session, pas par un test automatisé permanent.
- **L'e-mail d'accès juge (ADR-028) n'a pas de test avec un vrai serveur
  SMTP/Mailpit** — `FakeMailer` seulement (même limite que les e-mails
  d'ADR-019). Si le gabarit HTML casse avec un vrai client mail, ça ne sera
  pas détecté avant une compétition réelle.

## Depuis le Lot 5

- **File d'attente hors ligne et durabilité des échecs de synchronisation.**
  Lot 5 est en ligne uniquement : un échec réseau à la validation d'un
  passage laisse la ligne dans un état d'erreur *en mémoire seulement* (pas
  persisté), avec un bouton de réessai manuel. Si l'onglet est fermé ou
  l'appareil redémarre avant réessai réussi, la saisie est perdue et devra
  être ressaisie. La durabilité complète (survie à la fermeture d'onglet,
  file IndexedDB, retries automatiques) est le Lot 6.
- **Plusieurs tours ouverts simultanément sur la même voie.** Non détecté ni
  signalé : `GET /judge/routes` et `GET /judge/routes/:routeId` résolvent
  silencieusement le premier tour ouvert trouvé (`order by display_order`).
  Assumé hors périmètre par décision explicite pour ce lot.
- **`POST /judge/ascents/batch`** — endpoint batch pour la synchronisation
  hors ligne, Lot 6 (voir DECISIONS.md ADR-029).
- **Motif obligatoire sur les corrections organisateur** (au-delà de la
  fenêtre du juge) — Lot 8, pas construit ici ; les CHECK
  `ascent_status_shape_check`/`ascent_recorded_by_check` supportent déjà
  `recordedByUserId` pour cette saisie de secours, mais aucune route
  organisateur ne l'utilise encore.
- **Recherche compétiteur floue/normalisée** (accents, fautes de frappe) sur
  l'écran voie du juge — filtrage naïf pour ce lot, à revoir si un club
  signale un vrai problème d'usage.
- **Vibration/Wake Lock non testés automatiquement** — ni Playwright ni
  Vitest ne peuvent réellement exercer `navigator.vibrate`/Wake Lock dans un
  navigateur headless de façon fiable ; vérification manuelle uniquement, à
  noter comme limite connue de la couverture de test de ce lot.
- **Migration `0004_ascent_superseded_by_deferrable` absente de
  `drizzle/meta/_journal.json`** (DECISIONS.md ADR-031) — elle ne correspond
  à aucun changement de `schema.ts` (Drizzle Kit ne sait pas exprimer
  `DEFERRABLE`), donc rien à générer. Vérifier qu'un futur `drizzle-kit
  generate` ne réutilise pas par erreur le numéro `0004` s'il ne scanne pas
  le contenu réel du dossier `drizzle/` pour choisir le prochain indice.
- **Ouverture/clôture des tours : seulement débloquée au minimum**
  (DECISIONS.md ADR-030). Format phases : `status` accepté par le `PATCH
  .../rounds/:roundId` générique, mais aucun bouton dans `RoundsTab.vue` —
  un organisateur ne peut pas encore ouvrir un tour depuis l'écran, seulement
  par un appel API direct. Format contest : le round implicite s'ouvre
  automatiquement quand la compétition passe à `running`, mais rien ne le
  referme (le Lot 8 devra décider s'il se clôture avec la compétition ou
  reste ouvert). Le vrai tableau de bord (garde-fous, alertes, historique,
  publication des résultats) est entièrement à construire au Lot 8.
