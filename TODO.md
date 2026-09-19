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
- ~~Motif obligatoire sur les corrections organisateur~~ Résolu au Lot 8 :
  `PATCH /competitions/:id/ascents/:id` (`routes/organizer-ascents.ts`,
  DECISIONS.md ADR-049), motif requis par le schéma
  (`correctAscentByOrganizerInputSchema`).
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
  `DEFERRABLE`), donc rien à générer. ~~Vérifier qu'un futur `drizzle-kit
  generate` ne réutilise pas par erreur le numéro `0004`~~ Arrivé exactement
  comme prévu au Lot 8 : `drizzle-kit generate` a proposé `0004_lot8_activity_log`
  (ne voyait pas le fichier `.sql` déjà présent, seulement son propre
  journal). Renommé à la main en `0005_lot8_activity_log` (fichier `.sql`,
  `.down.sql`, `meta/0005_snapshot.json`, et l'entrée `idx`/`tag` de
  `meta/_journal.json`) avant de committer. Le risque reste entier pour la
  **prochaine** migration générée : toujours vérifier le contenu réel de
  `drizzle/` après un `db:generate`, pas seulement `_journal.json`.
- ~~Ouverture/clôture des tours : seulement débloquée au minimum~~ Résolu au
  Lot 8 : transitions avec garde-fous (`POST
  .../round-status/:roundId`, DECISIONS.md ADR-045/ADR-046), boutons dans
  `PilotageRounds.vue` (onglet Pilotage, pas `RoundsTab.vue` — la
  préparation et le pilotage jour J restent deux écrans séparés), pour les
  deux formats.

## Depuis le Lot 6

- ~~Alerte organisateur pour les conflits : données seulement, pas d'UI.~~
  Résolu au Lot 8 : `GET .../conflicts`, `POST .../conflicts/:id/resolve`
  (`routes/conflicts.ts`), onglet Conflits (`PilotageConflicts.vue`), et
  alerte dédiée dans `GET .../dashboard`.
- **Les endpoints juge à un seul élément (Lot 5, `POST /ascents`, `.../ascents/last/correct`)
  ne sont plus jamais appelés par le client web** après ce lot — toute saisie
  passe désormais par Dexie + `packages/sync` + `/ascents/batch`, y compris
  en ligne (« un lot d'un seul élément » en pratique). Les deux endpoints
  restent dans l'API (documentés, testés, ADR-029) pour un usage hors du
  client web, mais deviennent du code serveur non exercé par aucun parcours
  utilisateur réel — à surveiller pour ne pas le laisser pourrir
  silencieusement si un futur refactor y touche sans le remarquer.
- **Test de quota IndexedDB plein : non automatisé.** `fake-indexeddb`
  (utilisé pour les tests Vitest de `apps/web`) n'expose aucun mécanisme de
  quota configurable — il ne simule pas de limite de stockage réelle. Un test
  fiable nécessiterait un vrai navigateur avec un contrôle de quota via CDP
  (`page.context().newCDPSession()`), non tenté dans ce lot faute de temps.
  Ce qui est garanti par construction : `enqueue()` propage toute exception
  Dexie (dont un `QuotaExceededError` réel) à l'appelant plutôt que de
  l'avaler — mais rien ne vérifie aujourd'hui par un test automatisé que
  l'écran affiche un message clair dans ce cas précis.
- **Pas de nombre maximal de tentatives de réessai** dans `packages/sync`
  (règle d'or : jamais d'abandon silencieux) — un élément `pending` reste
  éligible indéfiniment. Si un item reste bloqué durablement (ex. bug
  serveur non détecté), rien n'alerte l'organisateur au-delà du bandeau
  juge local (« Hors ligne, N saisies en attente » resterait affiché tant
  que le juge n'est pas revenu en ligne, sans limite de temps).
- **Un juge révoqué pendant qu'il est hors ligne ne l'apprend qu'à la
  prochaine tentative de synchronisation** (401 renvoyé par
  `POST /ascents/batch`, traité comme un échec transport ordinaire — la
  file retente indéfiniment avec repli exponentiel, sans jamais distinguer
  ce cas d'une simple coupure réseau). Les écrans juge ne faisant plus aucune
  lecture réseau (ADR-012), il n'y a plus d'autre point de contact pour
  détecter une révocation avant ce moment. Pas construit ce lot — noté pour
  ne pas être surpris si un club signale ce scénario en usage réel.
- **Un `rejected` (création) n'annule pas l'écriture optimiste déjà faite
  dans le cache local** (`routeDetails`) — le compétiteur reste affiché
  « fait » avec un avertissement permanent, plutôt que de réapparaître en
  « à faire ». Simplification assumée pour ce lot (voir commentaire dans
  `apps/web/src/judge/useAscentRowState.ts`) : reverter proprement une
  création rejetée demanderait de restaurer un état « avant » qu'on ne
  connaît pas encore pour ce cas (contrairement à une correction, qui elle
  a un état antérieur clair). Si un club rencontre un `rejected` en usage
  réel, prévoir cette reprise à ce moment-là plutôt que la construire à
  l'aveugle.

## Depuis le Lot 7

- ~~Un contest reste « provisoire » pour toujours tant que le Lot 8 n'a pas
  construit la vraie publication.~~ Résolu au Lot 8 : `POST
  .../round-status/:roundId` fonctionne pour le tour implicite du contest
  exactement comme pour un tour phases (DECISIONS.md ADR-045/ADR-046).
- **Filtre « ascent actif » et liste des statuts de roster dupliqués entre
  `judge-ascents.ts` et `public-ranking.ts`** (`superseded_by IS NULL AND
  conflict_group IS NULL` ; `['registered', 'present']`) — pas de
  refactorisation pour converger les deux, conformément à « tu ne réécris
  pas ce qui marche ». À revoir si un troisième consommateur apparaît.
- **`infra/scripts/load-test-sse.ts` a son propre `tsconfig.json` mais
  n'est couvert par aucun script racine `pnpm typecheck`/`pnpm lint`** — ce
  dossier n'est pas un paquet du workspace pnpm (pas de `package.json`), et
  Turbo ne le voit donc pas. Vérifié manuellement (`tsc --noEmit -p
  infra/scripts/tsconfig.json`, `eslint infra/scripts/load-test-sse.ts`)
  pendant ce lot, mais rien ne le revérifiera automatiquement à la prochaine
  modification.
- **Test de limitation de débit publique : vérifie l'en-tête
  `RateLimit-Limit`, pas un vrai épuisement à 429.** Cohérent avec le reste
  du dépôt (aucun test existant n'exerce un vrai 429, `hono-rate-limiter`
  n'a jamais été testé jusqu'au bout ailleurs non plus) — pas une régression
  de rigueur propre à ce lot, mais à améliorer si la question se pose à
  nouveau.
- **`usePublicStream` ne gère pas un changement de `slug` sans démontage
  complet du composant** (`apps/web/src/pages/public/PublicCompetition.vue`
  le construit une seule fois avec la valeur initiale) — sans conséquence
  dans les parcours actuels (aucun lien de l'application ne mène d'une
  compétition publique à une autre sans navigation complète), mais à
  revoir si ce cas d'usage apparaît.

## Depuis le Lot 8

- ~~Bug pré-existant : un rechargement complet du navigateur sur une route
  organisateur profonde (ex. `/competitions/:id`) perd la session.~~ Résolu
  au Lot 9. Cause racine : `router.ts` sautait le bootstrap de session avec
  `to.path.startsWith('/c')` (prévu pour la page publique `/c/<slug>`), qui
  attrapait aussi `/competitions/...`. Sans session restaurée, la garde
  redirigeait vers `login`, puis la navigation suivante faisait le bootstrap
  tardivement et renvoyait vers `/` (`guestOnly`) — d'où l'arrivée sur
  l'accueil « sans passer par `/login` ». Remplacé par un drapeau explicite
  `meta.skipOrganizerSession` porté par les routes `/j` et `/c`
  (`apps/web/src/router.ts`), testé par `router.test.ts` et par un
  rechargement réel dans `e2e/organizer-pilotage.spec.ts`.
  `e2e/judge-conflict.spec.ts`, qui échouait « pour une raison apparentée »,
  repasse au vert avec ce correctif.
- **`eventType: 'voided'` (`ascent_event`) reste non utilisé.** Aucune
  action « annuler complètement un passage » distincte de la correction
  n'a été construite ce lot — une correction vers un statut adapté (DSQ,
  DNS…) couvre le besoin exprimé par ROADMAP.md. Si un vrai besoin
  d'annulation (faire disparaître un passage du décompte sans le
  requalifier) apparaît, prévoir une action dédiée à ce moment-là.
- **Pas de SSE pour le tableau de bord organisateur, polling à 8 s**
  (DECISIONS.md ADR-045, décidé avec l'utilisateur). À revisiter si un club
  signale un tableau de bord perçu comme trop lent en usage réel — le
  travail d'authentification d'un flux SSE organisateur (jeton signé en
  query param, `EventSource` ne portant pas de header) resterait à faire.
- **Alerte « voie sans saisie depuis 15 minutes » : pas de vrai horodatage
  d'ouverture du tour.** En l'absence de toute saisie, `computeDashboard`
  utilise `round.updated_at` comme approximation de « depuis l'ouverture »
  (`lib/dashboard.ts`) — imprécis si le tour a été mis à jour pour une autre
  raison après son ouverture (répartition des voies, etc.). Un vrai
  `round.opened_at` séparé résoudrait ça proprement si l'imprécision pose
  un jour problème en usage réel.
- **`judge.last_seen_at` mis à jour à chaque appel authentifié** (ADR-048)
  ajoute une écriture DB par requête juge — négligeable à l'échelle d'un
  club (quelques juges, quelques requêtes/minute chacun), à surveiller si
  un jour le volume change d'ordre de grandeur.
- **`GET .../activity-log` n'est pas paginé**, cohérent avec le reste du
  dépôt à cette échelle (TODO.md Lot 3) — à revoir si une compétition très
  active (des centaines de passages sur plusieurs jours) rend la réponse
  trop grosse.
- **`e2e/organizer-pilotage.spec.ts` ne couvre que la résolution de
  conflit par « choix », pas par « nouvelle valeur »**, ni la saisie de
  secours (couvertes par les tests d'intégration API,
  `conflicts.test.ts`/`organizer-ascents.test.ts`, mais pas par un parcours
  navigateur complet) — pas fait par manque de temps dans ce lot, le
  scénario choisi couvre déjà tout le reste du pilotage (tours, correction,
  publication, reflet public).

## Depuis le Lot 9

- **`e2e/judge-offline-sync.spec.ts` est instable quand toute la suite e2e
  tourne à la suite** (échec à l'assertion « Hors ligne, 10 » après les dix
  saisies), et passe à chaque fois seul. Observé sur 3 exécutions complètes :
  2 échecs, dont un AVANT les changements de code du Lot 9 — ce n'est donc pas
  une régression de ce lot. Non investigué. Piste : dépendance à l'ordre ou à
  l'état d'activation du service worker après un test précédent. Rapporté ici
  plutôt que corrigé, faute de cause établie.
- **Qualifiés sans aucun passage réel** (voir `RULES.md` § 5, à faire valider) :
  un inscrit jamais déclaré absent qui n'a rien grimpé se qualifie s'il y a
  moins de participants réels que de places. Aucune règle ajoutée : c'est une
  règle de compétition à trancher avec un juge fédéral, pas un choix technique.
- **Pas de notification poussée vers les juges à l'ouverture d'un tour**
  (ADR-055) : le juge voit le nouveau tour au prochain retour au premier plan
  ou via « Actualiser mes voies ». Une poussée SSE vers les juges serait
  l'étape suivante si ce délai gêne en usage réel.
- **Une correction d'un tour précédent après l'ouverture du suivant modifie son
  classement mais pas la liste des qualifiés** (ADR-054, voulu). Rien
  n'avertit l'organisateur que la liste figée diffère alors de ce qu'un
  recalcul donnerait — à ajouter si le cas se présente en usage réel.
