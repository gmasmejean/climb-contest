# ClimbContest

PWA de gestion de compétitions d'escalade de difficulté pour les clubs —
organisateurs, juges (y compris hors ligne), public en temps réel.

Le contexte métier et les règles sont dans `SPEC.md`, le découpage en lots
dans `ROADMAP.md`, les décisions d'architecture dans `DECISIONS.md`. Ce
fichier ne documente que le démarrage et le développement.

## Démarrage rapide (Docker)

Prérequis : Docker et Docker Compose.

```sh
git clone <url-du-dépôt> climbcontest && cd climbcontest
cd infra/docker && cp .env.example .env
docker compose up --build -d
docker compose --profile seed run --rm seed   # optionnel : compétition de démo
```

Ouvrez ensuite <http://localhost:8080> :

- inscrivez un compte organisateur (l'e-mail de vérification part vers
  Mailpit, jamais un vrai e-mail en local) — interface Mailpit sur
  <http://localhost:8025> ;
- ou connectez-vous avec le compte de démo créé par `seed` :
  `organisateur@club-demo.test` / `ChangeMoi123!` (voir la sortie de la
  commande pour le lien et le PIN de démonstration des juges).

Pour tout arrêter : `docker compose down` (ajoutez `-v` pour effacer aussi
les données Postgres).

## Développement (sans Docker pour le code, avec Docker pour Postgres)

Prérequis : Node.js 22, pnpm 9 (`corepack enable` suffit à l'installer), et
Docker (pour Postgres/Mailpit en dev, et pour les tests d'intégration via
Testcontainers).

```sh
pnpm install
cd infra/docker && cp .env.example .env && docker compose up -d postgres mailpit
cd ../.. && cp infra/docker/.env apps/api/.env   # ou adaptez apps/api/.env à la main
pnpm --filter @climbcontest/db db:migrate
pnpm dev
```

`pnpm dev` lance `apps/api` (port 3000, rechargement à chaud) et `apps/web`
(Vite, port 5173, proxy `/api` vers l'API) en parallèle.

## Commandes utiles

| Commande                                         | Effet                                                        |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `pnpm typecheck`                                 | `tsc`/`vue-tsc --noEmit` sur tous les paquets                |
| `pnpm lint`                                      | ESLint sur tout le monorepo                                  |
| `pnpm test`                                      | Vitest sur tous les paquets (Testcontainers pour `db`/`api`) |
| `pnpm build`                                     | Build de production de chaque paquet/app                     |
| `pnpm --filter @climbcontest/db db:generate`     | Génère une migration depuis `schema.ts`                      |
| `pnpm --filter @climbcontest/db db:migrate`      | Applique les migrations en attente                           |
| `pnpm --filter @climbcontest/db db:migrate:down` | Annule la dernière migration                                 |
| `pnpm --filter @climbcontest/db db:seed`         | Insère une compétition de démonstration                      |

## Structure du monorepo

Voir `SPEC.md` § 6.2. En bref :

```
apps/api        Hono — API HTTP, auth organisateur, préparation de compétition
                (Lot 3), juges et accès juge (Lot 4), saisie des passages par
                le juge en ligne (Lot 5) puis par lot hors ligne (Lot 6) —
                `GET /judge/bootstrap`, `POST /judge/ascents/batch` ;
                classement public caché et diffusion temps réel par SSE
                (Lot 7) — `GET /public/:slug/rankings`,
                `GET /public/:slug/stream` ; pilotage jour J (Lot 8) —
                tableau de bord (`GET .../dashboard`), transitions de tour
                (`POST .../round-status/:roundId`), conflits
                (`GET/POST .../conflicts`), correction et saisie de secours
                (`.../ascents`), statut compétiteur, journal d'activité
apps/web        Vue 3 + Vite — PWA (auth, espace organisateur : compétitions,
                catégories, compétiteurs, voies, tours, juges — Lot 3/4 ;
                accès juge `/j/<token>` — Lot 4 ; ses voies, saisie et
                correction d'un passage, hors ligne (Dexie + file de
                synchronisation, bandeau d'état) — Lot 5/6 ; page publique
                `/c/<slug>` et écran de salle `/c/<slug>/salle`, sans
                authentification, mise à jour en direct — Lot 7 ; onglet
                Pilotage — vue d'ensemble, tours, correction/secours,
                conflits, journal — Lot 8)
packages/db     Schéma Drizzle, migrations, seed
packages/contracts   Schémas Zod partagés (entités + payloads d'API)
packages/ui     Composants Vue partagés (bouton, champ, modale…)
packages/scoring     Moteur de cotation FFME (Lot 2) — zéro dépendance, voir RULES.md
packages/sync   Machine à états de la file de synchronisation hors ligne du
                juge (Lot 6) — zéro dépendance, testée avec des fakes en
                mémoire (voir DECISIONS.md ADR-014)
infra/docker    Dockerfile, docker-compose, Caddyfile
```

## Hors ligne (juge)

Le juge télécharge tout ce dont il a besoin en un appel (`GET
/judge/bootstrap`) au moment où il a encore du réseau ; chaque saisie est
ensuite écrite dans IndexedDB (Dexie) avant toute tentative réseau, puis
envoyée par lots (`POST /judge/ascents/batch`) dès que possible. Aucun écran
juge ne dépend du réseau pour s'afficher. Voir SPEC.md § 6.3 pour la
stratégie complète et `DECISIONS.md` (ADR-032 à ADR-039) pour les décisions
prises pendant ce lot.

Pour vérifier le mode avion en conditions réelles : Chrome DevTools →
Network → Offline (ou débrancher le wifi), noter des passages, recharger la
page, revenir en ligne — le bandeau en haut de l'écran juge doit toujours
refléter honnêtement l'état de la file.

## Page publique et temps réel

`/c/<slug>` (sans authentification) affiche le classement d'une catégorie,
la liste des voies (avec lecteur vidéo YouTube/Vimeo intégré si
reconnu), et l'état de chaque tour en format phases. `/c/<slug>/salle` est
une variante plein écran, gros caractères, qui défile automatiquement d'une
catégorie à l'autre — à brancher sur le vidéoprojecteur de la salle.

Le classement est recalculé côté serveur et caché
(`apps/api/src/lib/public-cache.ts`), invalidé par un pont `LISTEN/NOTIFY`
Postgres (`apps/api/src/lib/realtime-bridge.ts`, DECISIONS.md ADR-043) à
chaque écriture qui l'affecte. La page suit les mises à jour via SSE
(`GET /public/:slug/stream`), avec repli en sondage toutes les 30 s si le
flux échoue.

Pour mesurer la tenue en charge du flux SSE (ROADMAP.md Lot 7, cible 300
spectateurs simultanés) contre la pile Docker Compose locale, seedée :

```sh
pnpm loadtest:sse
LOAD_TEST_CONNECTIONS=500 pnpm loadtest:sse   # personnalise le nombre de connexions
```

Le script ne mesure pas la mémoire — observer `docker stats` sur le
conteneur `api` pendant l'exécution.

## Pilotage jour J

L'onglet **Pilotage** de l'espace organisateur (`/competitions/:id`, visible
quel que soit le format) rassemble le suivi en direct de la compétition,
distinct de la préparation (onglets Catégories/Compétiteurs/Voies/Tours) :

- **Vue d'ensemble** — progression par catégorie et par voie, compétiteurs
  n'ayant pas encore grimpé, état de chaque juge (dernier signe de vie,
  nombre de saisies), et les alertes (voie muette depuis 15 min, juge muet
  depuis 10 min, conflit non résolu, compétiteur sans passage un tour
  fermé). Rafraîchi par sondage toutes les 8 s (pas de flux temps réel ici,
  contrairement à la page publique — DECISIONS.md ADR-045) ;
- **Tours** — ouvrir/fermer/publier (et rouvrir/dépublier), pour les deux
  formats ; publier est bloqué tant qu'un conflit du tour n'est pas résolu ;
- **Voies** — corriger n'importe quel passage (motif obligatoire, historique
  conservé) ou saisir un passage à la place d'un juge (secours) ;
- **Conflits** — les deux valeurs côte à côte (juge, appareil, heure),
  choisir l'une ou saisir une troisième valeur ;
- **Journal** — l'historique complet de la compétition (saisies juge,
  corrections, conflits tranchés, changements de statut), filtrable et
  exportable en CSV.

Le statut d'un compétiteur (présent/absent/abandon/disqualifié, motif
toujours facultatif) se change depuis l'onglet Compétiteurs. Voir
`DECISIONS.md` (ADR-045 à ADR-049) pour les décisions prises pendant ce lot.

## Tests

- `pnpm test` couvre les paquets purs (`contracts`, `ui`, `scoring`, `sync`)
  sans dépendance externe, et les intégrations (`db`, `api`) via
  Testcontainers (Postgres 16 éphémère, un conteneur par run). `apps/web`
  utilise `fake-indexeddb` pour les tests touchant Dexie (file de
  synchronisation juge).
- `packages/scoring` (le moteur de cotation, voir `RULES.md`) exige 100 %
  de couverture de branches : `pnpm --filter @climbcontest/scoring test -- --coverage`.
- Huit tests Playwright end-to-end (`e2e/`) : connexion d'un compte déjà
  activé jusqu'à l'accueil ; inscription → vérification par e-mail (via
  Mailpit) → connexion ; un juge note un passage et le corrige (en ligne) ;
  un juge note 10 passages hors ligne, ferme/rouvre l'onglet, puis se
  resynchronise dans l'ordre de saisie ; deux appareils saisissent des
  valeurs différentes pour le même passage hors ligne et un conflit est
  signalé au retour du réseau ; un passage noté par le juge apparaît en
  direct dans le classement public d'un second onglet, sans rechargement ;
  un organisateur résout un conflit, corrige un passage et publie un tour
  depuis l'onglet Pilotage ; une compétition en phases jouée de bout en bout
  (qualification à deux voies, demi-finale, finale, classement final avec
  contre-performance) — voir `e2e/README.md` pour les lancer.
