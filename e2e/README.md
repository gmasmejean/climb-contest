# Tests end-to-end (Playwright)

Un seul test ce lot : connexion d'un organisateur déjà activé, arrivée sur
l'accueil (`ROADMAP.md` Lot 1, point 9).

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

`E2E_BASE_URL` permet de cibler une autre URL que
`http://localhost:8080` (celle de Caddy par défaut).
