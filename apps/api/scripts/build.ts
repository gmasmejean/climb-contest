/**
 * Bundle de production — inline tout (paquets internes `@climbcontest/*` et
 * dépendances npm pures JS) dans un seul fichier. Restent externes :
 * - les modules natifs (`argon2`, `pg`) — esbuild ne peut pas les bundler ;
 * - `dotenv`, `pino` et `qrcode` — CJS avec des `require(...)` dynamiques
 *   (accès fichier, worker threads) qu'esbuild ne sait pas convertir
 *   proprement en sortie ESM.
 * Les quatre doivent donc être présents dans le `node_modules` de l'image
 * Docker au runtime — voir `infra/docker/api.Dockerfile` et les dépendances
 * déclarées dans `package.json`. `pino-pretty` n'est jamais importé
 * statiquement (chargé dynamiquement par pino en développement uniquement) :
 * rien à externaliser pour lui.
 */
import { build } from 'esbuild'

const EXTERNAL_PACKAGES = ['argon2', 'dotenv', 'pg', 'pino', 'qrcode']

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: EXTERNAL_PACKAGES,
})
