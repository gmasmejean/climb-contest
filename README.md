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

| Commande | Effet |
|---|---|
| `pnpm typecheck` | `tsc`/`vue-tsc --noEmit` sur tous les paquets |
| `pnpm lint` | ESLint sur tout le monorepo |
| `pnpm test` | Vitest sur tous les paquets (Testcontainers pour `db`/`api`) |
| `pnpm build` | Build de production de chaque paquet/app |
| `pnpm --filter @climbcontest/db db:generate` | Génère une migration depuis `schema.ts` |
| `pnpm --filter @climbcontest/db db:migrate` | Applique les migrations en attente |
| `pnpm --filter @climbcontest/db db:migrate:down` | Annule la dernière migration |
| `pnpm --filter @climbcontest/db db:seed` | Insère une compétition de démonstration |

## Structure du monorepo

Voir `SPEC.md` § 6.2. En bref :

```
apps/api        Hono — API HTTP, authentification organisateur
apps/web        Vue 3 + Vite — PWA (inscription, connexion, accueil)
packages/db     Schéma Drizzle, migrations, seed
packages/contracts   Schémas Zod partagés (entités + payloads d'API)
packages/ui     Composants Vue partagés (bouton, champ, modale…)
packages/scoring     Moteur de cotation (Lot 2 — vide pour l'instant)
packages/sync   File de synchronisation hors ligne (Lot 6 — vide pour l'instant)
infra/docker    Dockerfile, docker-compose, Caddyfile
```

## Tests

- `pnpm test` couvre les paquets purs (`contracts`, `ui`) sans dépendance
  externe, et les intégrations (`db`, `api`) via Testcontainers (Postgres
  16 éphémère, un conteneur par run).
- Deux tests Playwright end-to-end (`e2e/`) : connexion d'un compte déjà
  activé jusqu'à l'accueil, et inscription → vérification par e-mail (via
  Mailpit) → connexion — voir `e2e/README.md` pour les lancer.
