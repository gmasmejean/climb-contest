# syntax=docker/dockerfile:1
#
# Multi-étapes : `deps` (installation, mise en cache par couche) →
# `source` (code complet, réutilisé par le build API et le build web) →
# `build` (bundle esbuild de l'API) → `runtime` (image finale servie).
# La même image `runtime` sert aussi de conteneur pour les migrations et le
# seed (voir docker-compose.yml, services `migrate`/`seed`, qui ne changent
# que la commande) — tout est déjà présent (tsx, code source packages/db).
#
# Contexte de build attendu : la racine du monorepo (pas infra/docker).

FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/scoring/package.json packages/scoring/package.json
COPY packages/sync/package.json packages/sync/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY packages/db packages/db
COPY packages/scoring packages/scoring
COPY packages/sync packages/sync
COPY packages/ui packages/ui

FROM source AS web-build
RUN pnpm --filter @climbcontest/web build

FROM source AS build
RUN pnpm --filter @climbcontest/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=source /app/node_modules ./node_modules
COPY --from=source /app/packages ./packages
COPY --from=source /app/apps/api/package.json ./apps/api/package.json
# pnpm crée un node_modules propre à chaque paquet du workspace (symlinks
# vers le store racine) — celui d'apps/api (pg, argon2, dotenv…) doit être
# copié explicitement, `packages` et le node_modules racine ne suffisent pas.
COPY --from=source /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
