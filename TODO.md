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
- ~~**Plusieurs tours ouverts simultanément sur la même voie.**~~ Résolu au Lot 12
  (ADR-065, point 7) : ouvrir une catégorie est refusé tant qu'une de ses voies sert
  déjà dans un autre tour ouvert. Reste non gardé : modifier les voies d'un tour
  (`PUT .../rounds/:id/routes`) **après** son ouverture peut recréer la situation ;
  l'écran juge retombe alors sur le premier tour trouvé (`order by display_order`).
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
- ~~`infra/scripts/load-test-sse.ts` n'est couvert par aucun script racine.~~
  Résolu au Lot 9 : `pnpm typecheck` et `pnpm lint` passent aussi sur
  `infra/scripts` (`tsc --noEmit -p infra/scripts/tsconfig.json`,
  `eslint infra/scripts`). En s'y remettant, le script SSE s'est révélé PÉRIMÉ :
  il déclenchait l'événement par un `PATCH` de statut de tour fermé depuis le
  Lot 8 ; il passe maintenant par `POST .../round-status/:id`.
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

- ~~`e2e/judge-offline-sync.spec.ts` instable quand toute la suite tourne à la
  suite.~~ Résolu au Lot 9 : c'était une course DANS LE TEST, pas dans le mode
  hors ligne. Le test coupait le réseau juste après la connexion, avant que le
  service worker ait fini d'installer son précache ; hors ligne, l'installation
  échoue et le rechargement suivant échouait en `ERR_INTERNET_DISCONNECTED`.
  Le test attend maintenant `navigator.serviceWorker.ready`. **Question laissée
  ouverte** : un juge qui coupe son réseau dans les toutes premières secondes
  suivant sa première connexion tomberait dans le même cas ; aucun indicateur
  « prêt pour le hors ligne » n'existe dans l'interface. À envisager si un
  club le rencontre.
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
- **`lib/qrcode-pdf.ts` (planche de QR codes, Lot 4) ne protège pas ses
  `drawText` contre un caractère hors WinAnsi** : un nom de compétition ou de
  juge avec un caractère non latin ferait lever la génération de la planche.
  Découvert en écrivant `lib/exports/pdf-text.ts` (ADR-057), qui règle le
  problème pour les résultats mais pas pour cette planche — non touchée, elle
  marche pour les cas courants. À faire converger sur `toSupportedText` si le
  cas se présente.
- **L'export CSV du journal d'activité (`lib/activity-log.ts`, Lot 8) n'a pas la
  neutralisation d'injection de formule** de `lib/exports/csv.ts` : un motif
  saisi par un organisateur commençant par `=` deviendrait une formule dans le
  tableur. À traiter dans la revue de sécurité du Lot 9 (étape suivante).
- **Le PDF de résultats n'affiche pas les caractères non latins** (ADR-057) :
  ils sortent en `?`.
- **Adaptateur de stockage S3 non livré** (ADR-058) : `STORAGE_DRIVER=s3` échoue
  au démarrage. À faire quand un déploiement sans disque persistant en aura
  besoin : SDK AWS, conteneur MinIO en CI, envoi multipart (parties de 5 Mio
  minimum, donc morceaux plus gros que 8 Mio ou regroupés côté serveur).
- **Supprimer une vidéo téléversée n'est ni réversible ni tracé dans le journal
  d'activité** (le fichier disparaît du disque). `CLAUDE.md` demande des saisies
  destructives réversibles et tracées ; une confirmation explicite la précède,
  mais le journal (`activity_log`, `event_type` restreint par un CHECK) ne
  l'enregistre pas. À faire si un organisateur perd une vidéo par erreur.
- **Aucun quota de vidéos par compétition** : seule la taille d'une vidéo est
  bornée (`VIDEO_MAX_BYTES`). Un club pourrait remplir le disque avec une vidéo
  par voie. À borner si le disque devient un souci.
- **Pas de reprise d'envoi entre appareils** : l'identifiant de reprise vit dans
  le `localStorage` du navigateur qui a commencé l'envoi.
- **La vidéo téléversée n'est pas mise en cache hors ligne** (elle est
  volontairement exclue du cache du service worker) : hors réseau, la page
  publique n'a pas de lecteur.
- **La purge RGPD ne touche pas au compte de l'organisateur** (e-mail, nom) : elle
  porte sur les données d'une COMPÉTITION. Supprimer un compte organisateur ou un
  club entier n'a pas d'action dédiée.
- **La purge n'est pas tracée dans le journal d'activité** (`activity_log.event_type`
  est restreint par un CHECK) : la trace est `competition.purged_at`. Ni qui l'a
  faite, ni quand exactement au-delà de cette date.
- **Aucune purge des sauvegardes déjà faites** : un fichier de sauvegarde d'avant
  la purge contient encore les données personnelles. À dire clairement dans
  `docs/EXPLOITATION.md` : purger une compétition ne purge pas les sauvegardes.
- **Un organisateur qui recharge sa page alors que le serveur est injoignable est
  renvoyé à l'écran de connexion** (ADR-060) : sa session ne se restaure qu'avec
  le serveur. Il doit attendre le retour du réseau. Un mode « lecture seule »
  qui garderait le dernier état affiché n'existe pas.
- **Rien ne dit à un juge que sa file est bloquée parce que son accès a été
  révoqué** : la répétition générale l'a confirmé — l'appareil du juge révoqué
  reçoit un 401, traité comme une coupure réseau, et réessaie indéfiniment. Ses
  saisies en attente n'atteindront jamais le serveur ; l'organisateur doit les
  ressaisir (saisie de secours). Déjà noté au Lot 6, maintenant mesuré.
- **Limitation de débit partagée par toute la salle** (mesuré par la répétition
  et le test SSE) : 120 lots de saisie par minute et par adresse, 300
  connexions SSE par minute et par adresse, 600 lectures publiques par minute.
  Tous les juges et spectateurs d'une salle partagent souvent UNE adresse
  publique (wifi). La cible de 300 spectateurs tient pile sur le plafond SSE :
  une vague de reconnexions après une coupure la dépasserait, et les spectateurs
  basculeraient alors sur le sondage à 30 s. Aucun perte de donnée (les
  clients réessaient), mais un classement moins « direct ».

## Depuis le Lot 10

- **Une page laissée ouverte ne cherche jamais de nouvelle version** (mesuré :
  aucun changement en 90 s de page ouverte après un redéploiement ; un simple
  rechargement, lui, bascule seul en ~3 s). Le navigateur ne vérifie le service
  worker qu'au chargement de la page : un téléphone de juge laissé ouvert toute
  la matinée ne se met pas à jour. À envisager : appeler `registration.update()`
  au retour au premier plan (`visibilitychange`) et à intervalle régulier
  (`registerSW({ onRegisteredSW })`). Non fait : hors du périmètre demandé.
- **Compatibilité entre une nouvelle version du code et des éléments déjà en file**
  (ADR-061) : le schéma Dexie n'a qu'une version (`local-db.ts`). Le jour où le
  format d'un élément de file (`queue-payload.ts`) change, il faudra une
  `version(2)` avec migration, testée avec des éléments écrits par la version
  précédente — désormais que la mise à jour s'active sans attendre une file vide.
- **Le volume `web-dist` accumule les anciens fichiers hachés** : `web-build` fait
  `cp -r` sans rien supprimer (153 fichiers dans `assets/` après quelques
  déploiements). Inoffensif, mais ça grossit ; à nettoyer (`rm -rf` avant la copie,
  en gardant à l'esprit qu'un navigateur encore sur l'ancienne version peut
  réclamer un ancien fichier haché pendant la bascule).
- **`e2e/` et `playwright.config.ts` ne sont couverts ni par `pnpm lint` ni par
  `pnpm typecheck`** (ESLint : « not found by the project service »). Antérieur au
  Lot 10 ; les fautes de type d'un test e2e ne sont vues qu'à son exécution.
- **`prettier --check` signale `judge/refresh-routes.test.ts` et
  `pages/judge/JudgeHome.vue`** (déjà le cas sur `main`, non touchés au Lot 10).
  `pnpm lint` n'exécute qu'ESLint, donc rien ne le signale en CI.
- **À vérifier, non reproduit** : dans `JudgeAscentEntry.vue`, le préremplissage
  d'une correction se décide une seule fois, à l'arrivée du compétiteur, sur
  `mode === 'correct'` ; or `mode` dépend de `lastSubmission`, une autre requête
  locale (Dexie). Si elle répond après le compétiteur, le mode est un instant
  `readonly` et le préremplissage serait sauté pour de bon. Le brouillon du Lot 10
  se déclenche bien quand `mode` change, mais le préremplissage d'origine n'a pas
  été touché.
- **Un test du Lot 10 a échoué 2 fois sur ~30 exécutions** avant d'être durci
  (`JudgeAscentEntry.test.ts`, « restaure la saisie après un rechargement »,
  échec immédiat). Cause supposée mais non prouvée : `flushLiveQueries` rend la
  main avant la première émission de Dexie (déjà signalé comme fragile sous
  charge). Le test attend maintenant explicitement que l'écran soit chargé, et 30+
  exécutions, dont sous saturation CPU, sont passées depuis. À surveiller.

## Depuis le Lot 11

- **Le statut de compétition reste presque un libellé.** Lot 12 (ADR-065) : « En cours »
  n'ouvre plus rien, mais on ne le quitte plus tant qu'une catégorie est ouverte, et
  ouvrir une catégorie passe la compétition à « En cours ». `open`, `closed` et
  `archived` ne sont toujours lus par personne et les autres transitions sont libres.
  À décider avec le Lot 13 : donner un sens à `open` (« inscriptions ouvertes » = « à
  venir » dans la recherche publique), et éventuellement verrouiller `closed`/`archived`
  en écriture.
- **Le garde-fou de clôture peut être croisé** par deux requêtes simultanées (ouvrir une
  catégorie pendant qu'un autre organisateur clôture la compétition), dans une fenêtre
  de quelques millisecondes (ADR-065). Un verrou de ligne sur la compétition le
  fermerait ; pas fait, le risque est négligeable à l'échelle d'un club.
- **Publication par catégorie sans test de conflit croisé.** Les tests couvrent le
  scénario matin / après-midi, le tout-ou-rien et la publication par catégorie, mais pas
  « un conflit chez les U18 ne retient pas la publication des U16 » (il faut un second
  appareil juge pour le créer). La règle est dans `roundHasUnresolvedConflicts`.
- **La corbeille ne refuse que `running`.** Un tour resté « ouvert » sur une
  compétition marquée « Clôturée » peut être mis à la corbeille avec des juges en train
  de saisir. Sans perte (les saisies restent en file locale et remontent après
  restauration), mais l'organisateur peut ne pas comprendre. Refuser aussi si un tour
  est ouvert était l'autre option (ADR-063).
- **Pas de purge automatique de la corbeille**, volontairement (ADR-063, comme
  ADR-051). Elle affiche « à la corbeille depuis N jours » mais ne rappelle rien : à
  ajouter comme le rappel de conservation si des corbeilles oubliées s'accumulent.
- **Filtrage de la liste côté navigateur** (ADR-062) : à passer côté serveur au-delà de
  quelques centaines de compétitions par club.
- **Le journal `competition_deletion_log` n'a pas d'écran.** Il est écrit et testé, mais
  seul un accès à la base permet de le lire.
- **La suppression définitive n'est pas atomique avec les fichiers** : les fichiers
  partent avant la transaction SQL. Si elle échoue, la compétition reste à la corbeille
  avec des vidéos « introuvables » (bénin, voulu — même ordre que la purge RGPD).

## Depuis le Lot 15

- **Toucher la prise sur la photo pour remplir le pavé du juge.** Idée notée en
  cadrant le lot (ADR-066), non demandée : le juge verrait la photo et toucherait la prise
  atteinte au lieu de taper son numéro.
- **Plusieurs photos par voie.** Une voie haute ne tient pas toujours sur une photo. Il
  faudrait une numérotation continue d'une photo à l'autre ; une seule photo par voie a
  été retenue (ADR-066).
- ~~**Détection des prises par couleur (Lot 16).**~~ Abandonnée, ADR-069.
- **Photo non publique.** Elle n'est visible que de l'organisateur et des juges affectés ;
  la page publique ne l'affiche pas.
- **Photo remplaçable après le premier passage.** Aujourd'hui figée (ADR-066) : un flou
  découvert le jour J ne se corrige pas. Une option serait d'autoriser le remplacement de
  l'image en conservant les prises (même cadrage) — pas fait, cela demande de dire à
  l'organisateur que les numéros ne bougent pas.
- **Ouverture au balayage vers la gauche.** Le panneau se ferme par balayage vers la
  droite ; l'ouvrir par balayage n'existe pas (le bouton « Voir la voie » suffit).
- **Le test e2e de la photo a échoué une fois sans qu'on sache pourquoi** (projet
  `chromium`, juste après le redéploiement du front : le juge ne voyait pas « Léa Martin »
  après avoir touché la voie). Non reproduit en 9 exécutions suivantes. Piste : la mise à
  jour du service worker (ADR-061) qui recharge la page en pleine séquence.
- **`asset.kind` accepte maintenant `route_photo`** ; le message d'erreur de la suppression
  définitive parle encore de « vidéos » quand le stockage manque.

## Depuis la page d'accueil (ADR-070)

- **Brancher la recherche (Lot 13).** Le champ et « Trouver une compétition » sont
  `disabled` avec la mention « Recherche bientôt disponible » (`LandingSearch.vue`). Le Lot 13
  retire les deux, ajoute la page de résultats, et peut alors rendre la carte Spectateurs
  cliquable.
- **Remplacer les visuels recadrés des maquettes IA** (`apps/web/src/assets/landing/*.webp`,
  941 px de large pour le mobile, statut juridique flou) par des illustrations HD à licence
  claire ; le logo SVG de `BrandLogo.vue` est une approximation du badge.
- ~~**Unifier la charte**~~ Fait, ADR-071.
- **Menu hamburger** de la maquette mobile : omis, il n'y a rien à y mettre.
- **`prettier-plugin-tailwindcss` ne connaît pas les jetons `@theme`** (il classe `bg-paper`,
  `text-ink`… en tête) : lui indiquer `tailwindStylesheet: apps/web/src/style.css` dans
  `.prettierrc.json` stabiliserait l'ordre des classes.

## Depuis l'extension de la charte (ADR-071)

- **`<RouterLink><Button>` imbriqués** dans `CompetitionList.vue` (« Nouvelle compétition »,
  « Corbeille ») : un bouton dans un lien est du HTML invalide. `Button` accepte maintenant
  `to` ; la conversion change le rôle ARIA (`button` → `link`) que des tests e2e ciblent —
  à faire avec eux.
- **28 fichiers ne sont pas au format Prettier** sur `main` (`pnpm format:check`), sans lien
  avec la charte ; non reformatés ici pour garder des diffs lisibles.
- **Cases à cocher natives** : seules deux portent `accent-blue-700` ; les autres gardent le
  bleu du navigateur.
- **Pilules sur deux lignes à 360 px** (« Voir l'accès », « Régénérer le PIN » dans l'onglet
  Juges) : lisibles et ≥ 48 px, mais massives. Libellés plus courts ou pile verticale à voir.
- **Écran de salle** (`PublicRoomScreen`) : fond sombre conservé, seulement re-teinté par les
  échelles. Une version « charte » (logo, Caveat pour le nom de catégorie) reste à décider.
- ~~**Test instable** `JudgeAscentEntry.test.ts` › « Voir la voie ouvre le panneau… sans
  réseau »~~ **Corrigé au Lot 18** : `syncEngine` est un singleton de module, vider
  `judgeDb.queue` ne vidait pas sa file EN MÉMOIRE, et son minuteur de repli envoyait les
  saisies d'un test précédent au milieu de celui-ci. Les deux `afterEach` du fichier
  appellent maintenant `syncEngine.hydrate()`. **Reste ouvert :** aucun autre fichier de
  test ne le fait ; un nettoyage global serait plus sûr qu'une discipline par fichier.

## Depuis les tableaux denses (Lot 18, ADR-074)

- **La ligne d'ajout rapide n'est pas collante** sous l'en-tête du tableau : au-delà d'une
  vingtaine de compétiteurs, il faut remonter pour saisir le suivant. Deux éléments collants
  imbriqués dans un `<tbody>` sont un nid à bugs de rendu ; à reprendre si la gêne est
  réelle à l'usage.
- **`table-fixed` tronque sans autre indice que l'infobulle `title`.** Un nom long est coupé
  vers 90 px à 1280 px. Une colonne redimensionnable, ou un choix de colonnes par
  l'organisateur, serait la vraie réponse — hors lot.
- **La colonne d'actions garde une largeur fixe** (`w-60` chez les compétiteurs) calée sur
  ses trois libellés : un libellé plus long la ferait passer sur deux lignes et gonflerait
  la ligne de 41 à 81 px. Fragile, faute de mesure automatique.
- **Aucune virtualisation** : 150 compétiteurs × 9 colonnes tiennent, 600 restent à mesurer.
  Si ça rame, la première réponse n'est pas la virtualisation (Lot 20 au mieux) mais moins
  de composants par cellule.
- **Recherche et filtre des onglets ne sont pas dans l'adresse**, contrairement à la liste
  des compétitions (ADR-062). Cohabiter avec `:tab?` et `?section=` pour un bénéfice faible ;
  à revoir si quelqu'un demande à partager « les juges triés par dernier accès ».
- **`prettier-plugin-tailwindcss` ne connaît pas la variante `fine:`** (ni les jetons
  `@theme`, déjà noté) : les classes `fine:` sont triées arbitrairement mais de façon
  stable, `format:check` ne casse pas. À régler avec la dette `tailwindStylesheet` du
  `.prettierrc`.
- **Le lien retour « ← Mes compétitions » fait 20 px de haut à partir de `lg`** (décision du
  Lot 17, `lg:min-h-0`). La garde e2e des 48 px est donc bornée au tableau sur les parcours
  de bureau ; à trancher si on veut une règle uniforme.

## Depuis le socle desktop (Lot 17, ADR-072)

- ~~**Liste, corbeille et création restent une colonne étroite**~~ Levé au Lot 18 pour la
  liste et la corbeille (`lg:max-w-none`). **`CompetitionCreate` garde son `max-w-2xl`** :
  c'est un formulaire, sa mise en grille est le Lot 19.
- **`Tabs` n'a pas de pastille** (`badge`) : prévue au plan, non écrite tant que rien ne
  l'alimente (compteurs de conflits / alertes / points bloquants → Lot 20).
- **Identifiants DOM en double** : les onglets de la page et les sous-onglets du pilotage
  produisent tous deux `#tab-rounds` (et `aria-controls="panel-…"` ne pointe sur aucun
  élément). Antérieur au Lot 17 ; `Tabs` devrait recevoir un préfixe d'identifiant et les
  panneaux porter `role="tabpanel"`.
- **Correction d'adresse `rounds` hors phases** (`CompetitionDetail`, `watchEffect`) : vérifiée
  en navigateur, couverte en unitaire par `resolveCompetitionTab` seulement — pas de test de
  composant de la page.
- **Pistes desktop écartées des Lots 17–20**, à arbitrer plus tard : sélection multiple et
  actions en lot sur les compétiteurs ; matrice juges × voies ; tours en colonnes côte à
  côte ; modales → panneau latéral ; classement provisoire à côté de la matrice de pilotage ;
  raccourcis clavier globaux ; navigation clavier dans les tableaux ; glisser-déposer des
  voies et dépôt de fichier ; sélecteur rapide de compétition ; feuille d'impression ; lien
  vers l'écran de salle depuis le pilotage ; exports en grille ; « Prêt à démarrer ? » en
  deux colonnes.

## Depuis le maître–détail (Lot 19, ADR-075 à ADR-077)

- **`RoutePhotoPanel` (écran juge) garde sa propre copie du zoom.** `useZoomableFrame`
  factorise le cadre zoomable du recadrage et de l'annotation, mais l'écran juge n'a pas été
  converti : le gain est cosmétique et `CLAUDE.md` déclare ces écrans non négociables. À faire
  si on y touche pour une autre raison.
- **`Modal` de `packages/ui` n'a ni piège de focus ni restitution du focus.** `PhotoCropDialog`
  et `HoldAnnotatorDialog` le font à la main, chacun de son côté : troisième implémentation du
  même besoin. Un `useDialog` (ou une `Modal` qui s'en charge) s'impose, hors lot.
- **Les modifications non enregistrées d'une voie ne survivent pas au rechargement.** `?route=`
  rouvre bien la voie, mais ses valeurs sont relues du serveur : `RouteEditorPanel` n'a pas de
  `useFormDraft` (seuls `InfosTab` et `CompetitionCreate` en ont un). À brancher si un
  organisateur perd une saisie longue.
- **Un portable de 1366 px n'a pas le maître–détail.** C'est le prix des colonnes à largeur
  fixe (`table-fixed`, ADR-074) : il faudrait des colonnes élastiques ou redimensionnables pour
  descendre plus bas. Même dette que « `table-fixed` tronque sans autre indice que l'infobulle ».
- **Les en-têtes de colonne ne s'alignent pas entre eux** quand certaines colonnes sont
  triables et d'autres non : le `<th>` sans bouton retombe plus bas. Visible sur les juges
  (« Voies » sous « Juge » et « Statut »). Antérieur au Lot 19, dans `DataList` — donc sur les
  six listes à la fois, ce qui vaut un lot à soi.
- **Le tri peut rester posé sur une colonne devenue invisible** (le PIN chez les juges, quand on
  passe sous 1280 px ou en maître–détail) : l'ordre reste celui de cette colonne sans que rien
  ne l'indique. Sans conséquence sur les données, déroutant à l'œil.
- **Le QR est dessiné deux fois dans le dépôt** : `qrcode` côté serveur pour la planche PDF,
  côté navigateur pour la fiche (ADR-076). Assumé — ni le même support ni les mêmes contraintes —
  mais deux versions à garder en phase.
- **Le panneau de détail n'est pas atteignable au clavier depuis la liste** autrement qu'en
  tabulant : pas de raccourci, pas de déplacement du focus vers le panneau à l'ouverture. À voir
  avec la « navigation clavier dans les tableaux » déjà écartée des Lots 17–20.
