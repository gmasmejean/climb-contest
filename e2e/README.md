# Tests end-to-end (Playwright)

Cinq tests à ce jour :

- `login.spec.ts` — connexion d'un organisateur déjà activé, arrivée sur
  l'accueil (`ROADMAP.md` Lot 1, point 9) ;
- `verify-email.spec.ts` — inscription, récupération du lien de
  vérification dans Mailpit, clic, connexion (régression pour ADR-020,
  `DECISIONS.md`) ;
- `judge-ascent.spec.ts` — un juge accède à sa voie, note un passage, le
  voit synchronisé, puis le corrige dans la fenêtre de correction
  (`ROADMAP.md` Lot 5, point 7). Amorcé par API (compte organisateur seedé),
  tourne en émulation mobile 360px (projet `mobile` ci-dessous) ;
- `judge-offline-sync.spec.ts` — coupe le réseau, un juge note 10 passages
  hors ligne, ferme/rouvre l'onglet (cas SPEC.md § 9 #23 : les 10 doivent
  survivre), rétablit le réseau, vérifie que les 10 remontent dans l'ordre de
  saisie (`ROADMAP.md` Lot 6) ;
- `judge-conflict.spec.ts` — deux appareils (deux contextes de navigateur,
  même juge) saisissent des valeurs différentes pour le même passage hors
  ligne, se resynchronisent en même temps : les deux valeurs sont
  conservées, un conflit est signalé avec les deux valeurs à l'appareil
  perdant (cas SPEC.md § 9 #22, `ROADMAP.md` Lot 6).

## Projets

- `chromium` — bureau, tous les tests sauf `judge-ascent.spec.ts`.
- `mobile` — `judge-ascent.spec.ts` uniquement, viewport 360×740 (le plus
  étroit visé par `CLAUDE.md`).

## Note sur l'exécution en parallèle

`judge-offline-sync.spec.ts` et `judge-conflict.spec.ts` sont sensibles au
délai — ils attendent des transitions d'état réelles (retour réseau,
synchronisation) avec des délais de plusieurs secondes. Lancés en parallèle
avec d'autres suites sur une machine chargée (plusieurs workers Playwright
partageant la même pile Docker locale, un seul Postgres), ils peuvent
occasionnellement dépasser leur délai d'attente — même limite de fond que
celle déjà documentée dans `TODO.md` pour les conteneurs de test de
`apps/api`. En cas d'échec isolé sous charge, relancer avec `--workers=1`
avant de suspecter une régression.

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
