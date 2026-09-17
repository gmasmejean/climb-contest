# Tests end-to-end (Playwright)

Trois tests à ce jour :
- `login.spec.ts` — connexion d'un organisateur déjà activé, arrivée sur
  l'accueil (`ROADMAP.md` Lot 1, point 9) ;
- `verify-email.spec.ts` — inscription, récupération du lien de
  vérification dans Mailpit, clic, connexion (régression pour ADR-020,
  `DECISIONS.md`) ;
- `judge-ascent.spec.ts` — un juge accède à sa voie, note un passage, le
  voit synchronisé, puis le corrige dans la fenêtre de correction
  (`ROADMAP.md` Lot 5, point 7). Amorcé par API (compte organisateur seedé),
  tourne en émulation mobile 360px (projet `mobile` ci-dessous).

## Projets

- `chromium` — bureau, tous les tests sauf `judge-ascent.spec.ts`.
- `mobile` — `judge-ascent.spec.ts` uniquement, viewport 360×740 (le plus
  étroit visé par `CLAUDE.md`).

## Prérequis

La pile complète doit tourner et contenir le compte de démo :

```sh
cd infra/docker && docker compose up --build -d
docker compose --profile seed run --rm seed
```

## Lancer le test

Depuis la racine du dépôt :

```sh
pnpm exec playwright install --with-deps chromium   # une seule fois
pnpm exec playwright test
```

Pour ne lancer que le parcours juge mobile :

```sh
pnpm exec playwright test --project=mobile
```

`E2E_BASE_URL` permet de cibler une autre URL que `http://localhost:8080`
(celle de Caddy par défaut), `E2E_MAILPIT_URL` une autre URL que
`http://localhost:8025`.
