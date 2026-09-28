# ClimbContest

PWA de gestion de compétitions d'escalade de difficulté pour les clubs —
organisateurs, juges (y compris hors ligne), public en temps réel.

Le contexte métier et les règles sont dans `SPEC.md`, le découpage en lots
dans `ROADMAP.md`, les décisions d'architecture dans `DECISIONS.md`. Ce
fichier ne documente que le démarrage et le développement.

## Documentation

| Pour qui | Fichier |
|---|---|
| Un bénévole qui prépare et pilote une compétition | [`docs/GUIDE-ORGANISATEUR.md`](docs/GUIDE-ORGANISATEUR.md) |
| Chaque juge, le matin (une page à imprimer) | [`docs/GUIDE-JUGE.md`](docs/GUIDE-JUGE.md) |
| Qui installe, sauvegarde et dépanne | [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) |
| Les règles de cotation, à faire valider par un juge fédéral | [`packages/scoring/RULES.md`](packages/scoring/RULES.md) |

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

**En production**, rien ne se fait à la main sur le serveur : un push sur la
branche `production` teste, construit et déploie l'application sur le VPS
(HTTPS, vrai SMTP, sauvegarde avant chaque migration). Installation du serveur,
mise en production et retour arrière : `docs/EXPLOITATION.md` § 9 (ADR-084).

```sh
git push origin main:production
```

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
| `pnpm rehearsal`                                 | Répétition générale : 60 compétiteurs, coupures provoquées   |
| `pnpm loadtest:sse`                              | 300 spectateurs sur le flux temps réel                       |
| `infra/scripts/backup.sh`                        | Sauvegarde la base et les vidéos et photos                   |
| `infra/scripts/verify-restore.sh`                | Prouve qu'une sauvegarde se restaure (sans danger)           |

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
                (`.../ascents`), statut compétiteur, journal d'activité ;
                grille compétiteurs × voies (Lot 20) —
                `GET .../ascents/matrix?roundId=&categoryId=`
apps/web        Vue 3 + Vite — PWA (auth, espace organisateur : compétitions,
                catégories, compétiteurs, voies, tours, juges — Lot 3/4 ;
                accès juge `/j/<token>` — Lot 4 ; ses voies, saisie et
                correction d'un passage, hors ligne (Dexie + file de
                synchronisation, bandeau d'état) — Lot 5/6 ; page publique
                `/c/<slug>` et écran de salle `/c/<slug>/salle`, sans
                authentification, mise à jour en direct — Lot 7 ; onglet
                Pilotage — vue d'ensemble, tours, correction/secours,
                conflits, journal — Lot 8, poste multi-panneaux et matrice
                compétiteurs × voies sur grand écran — Lot 20 ; page
                d'accueil publique `/`, ADR-070)
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

### Juge révoqué, changement de juge (Lot 21)

Révoquer un juge ne perd plus ses saisies en attente (ADR-078). Son téléphone
les envoie quand même : le serveur les reçoit **en quarantaine** — hors
classement — et l'organisateur les retrouve dans **Pilotage → Conflits**, sous
« Saisie d'un accès révoqué — à valider » : accepter, refuser (motif
obligatoire) ou saisir une autre valeur. Tant qu'il en reste, la catégorie ne se
publie pas. Côté juge, l'écran « Votre accès a été révoqué » laisse la file finir
de partir, puis déconnecte ; toutes les autres routes juge répondent 401 avec
`code: "judge_revoked"`.

Ouvrir le lien d'un **autre** juge sur un téléphone ne vide plus jamais une file
en attente (ADR-079) : elle part d'abord, avec l'ancien jeton, puis une
confirmation nominative est demandée. Rescanner son propre lien ne demande rien.

Parcours e2e : `e2e/judge-revoked.spec.ts` (projet `mobile`, 360 px). La
répétition générale (`pnpm rehearsal`) joue aussi le cas du juge révoqué.

### Mise à jour de l'application

Après un redéploiement (push sur `production`, ou `docker compose up --build -d` en local), un navigateur qui
**recharge la page** télécharge la nouvelle version en arrière-plan, l'active et
recharge la page une fois, tout seul, quelques secondes plus tard (mesuré : ~3 s
en local). Recharger ne perd aucune saisie (ADR-061) : celles déjà confirmées
sont dans IndexedDB ; celle qu'un juge est en train de composer est gardée dans
un brouillon de 10 minutes et restaurée, dans l'étape de saisie, avec le message
« Saisie retrouvée : vérifiez-la avant de valider. ».

**Limite connue** : le navigateur ne cherche une nouvelle version qu'au chargement
de la page. Une application restée ouverte sans être rechargée (un téléphone de
juge laissé en veille toute la matinée) ne se met à jour qu'à son prochain
rechargement — mesuré : aucune mise à jour en 90 s de page ouverte (`TODO.md`,
Lot 10). Après un déploiement le jour d'une compétition, faites recharger les
appareils.

## Page d'accueil publique

`/` s'affiche sans authentification (ADR-070) : en-tête avec le logo et la
pilule « Espace organisateur » (→ `/login`), titre, recherche, quatre cartes
(Organisateurs, Juges, Spectateurs, Grimpeurs), mur d'escalade et foule en
aquarelle. Un organisateur connecté y retrouve son nom, « Mes compétitions »
et « Se déconnecter », et la session y est restaurée au rechargement — mais
depuis ADR-080 ce n'est plus la page d'arrivée après connexion : c'est
`/competitions` (voir « Espace organisateur » ci-dessous).

- **La recherche est désactivée** et le dit (« Recherche bientôt
  disponible ») : la recherche publique est le Lot 13, non engagé. Rien n'est
  simulé.
- La carte Juges ne devient un lien (vers `/j/home`) que si un accès juge
  existe déjà sur l'appareil ; Spectateurs et Grimpeurs (« Bientôt ») ne sont
  pas des liens.
- Visuels : `apps/web/src/assets/landing/*.webp`, recadrés des maquettes
  fournies (provisoires, voir `TODO.md`). Images et polices ne sont pas dans
  le précache du service worker (cache à la demande).

## Charte graphique

La charte aquarelle de l'accueil s'applique à toute l'application (ADR-071).

- **Couleurs** : `apps/web/src/style.css` redéfinit dans `@theme` les échelles
  Tailwind `gray` (neutres encre), `blue` (navy, `blue-700` = `#184e67`),
  `red` (corail), `amber` (ocre) et `green` (sauge). On continue d'écrire
  `text-red-700` ou `bg-blue-50` : c'est la valeur qui change, pas la classe.
  `brand-contrast.test.ts` lit ce fichier et exige le contraste AA pour chaque
  couple texte/fond utilisé — **ne modifiez pas une teinte sans le relancer**,
  et ajoutez-y tout nouveau couple.
- **`Button`** (`packages/ui`) est une pilule : `primary`, `secondary`,
  `danger`, `glass` (translucide, à poser sur un décor) ; avec `to`, c'est un
  vrai lien.
- **`BrandShell`** (`components/brand/`) enveloppe les pages hors notation
  (connexion, inscription, organisateur, page publique, accès juge) : polices
  Source Sans 3 / Caveat (`brand-fonts.ts`, auto-hébergées, OFL), fond papier,
  en-tête avec le logo (`BrandLogo.vue`) ; `decor` ajoute le mur aquarelle
  (pages d'entrée seulement). Le `<main>` de la page porte `flex-1`.
- **Écrans de notation du juge** (`/j/home`, voies, saisie) : couleurs
  seulement. Ni `BrandShell`, ni police, ni image — rien de plus à précacher.
  L'écran de salle (`/c/<slug>/salle`) reste sombre.
- Favicon, icônes PWA, `theme-color` et manifest portent le logo navy.

## Page publique et temps réel

`/c/<slug>` (sans authentification) affiche le classement d'une catégorie,
la liste des voies (avec lecteur vidéo YouTube/Vimeo intégré si
reconnu), l'état de chaque tour en format phases, et, en dessous, la fiche de
l'organisation (voir plus bas). `/c/<slug>/salle` est
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

- **Vue d'ensemble** — progression par catégorie et par voie (en barres),
  compétiteurs n'ayant pas encore grimpé, état de chaque juge (dernier signe
  de vie, nombre de saisies), et les alertes (voie muette depuis 15 min, juge
  muet depuis 10 min, conflit non résolu, compétiteur sans passage un tour
  fermé). Rafraîchi par sondage toutes les 8 s (pas de flux temps réel ici,
  contrairement à la page publique — DECISIONS.md ADR-045) ;
- **Tours** — ouvrir/fermer/publier (et rouvrir/dépublier), pour les deux
  formats ; publier est bloqué tant qu'un conflit du tour n'est pas résolu ;
- **Voies** — corriger n'importe quel passage (motif obligatoire, historique
  conservé) ou saisir un passage à la place d'un juge (secours). À partir de
  1024 px, une **grille compétiteurs × voies** remplace le choix d'une voie à
  la fois (Lot 20, voir plus bas) ;
- **Conflits** — les deux valeurs côte à côte (juge, appareil, heure),
  choisir l'une ou saisir une troisième valeur ;
- **Journal** — l'historique complet de la compétition (saisies juge,
  corrections, conflits tranchés, changements de statut), filtrable par type,
  par acteur et par dates, et exportable en CSV.

Un **bandeau d'état** apparaît au-dessus des cinq sous-sections dès qu'une
lecture échoue : il dit depuis quand les chiffres datent, et que les saisies
des juges restent sur leurs téléphones. Le sondage est unique pour toute la
page (`useCompetitionPulse`) et tourne quand la compétition est « En cours »
ou quand l'onglet Pilotage est ouvert.

**Le statut d'un tour se porte par catégorie** (Lot 12, ADR-065) : les U16 peuvent finir
leur qualification le matin quand les U18 n'ont pas commencé. Dans **Pilotage → Tours**,
chaque tour montre une ligne par catégorie, avec son état (brouillon, ouvert, fermé,
publié) et ses actions ; une action groupée ouvre ou ferme plusieurs catégories d'un coup
(un refus sur l'une refuse l'ensemble et la nomme). Ouvrir la demi-finale d'une catégorie
exige que sa qualification soit terminée, sans regarder les autres catégories ; une voie
ne peut servir que dans un seul tour ouvert. Le statut de la **compétition** (« En cours »,
« Clôturée »…) n'ouvre plus rien : ouvrir une catégorie la passe à « En cours », et on ne
peut pas la clôturer tant qu'une catégorie est ouverte. La page publique montre l'état des
tours pour la catégorie affichée.

Le statut d'un compétiteur (présent/absent/abandon/disqualifié, motif
toujours facultatif) se change depuis l'onglet Compétiteurs. Voir
`DECISIONS.md` (ADR-045 à ADR-049) pour les décisions prises pendant ce lot.

## Données personnelles (RGPD)

Les compétiteurs sont souvent mineurs. Dans l'onglet **Exports**, le
**propriétaire** de l'organisation peut exporter tout ce qui identifie une personne, puis
**supprimer** les données personnelles d'une compétition : noms, années de
naissance, clubs, licences, vidéos, photos de voie et motifs saisis. Les résultats restent, sans
personne derrière ; la ligne de la compétition reste comme trace de la purge.
Il faut retaper le nom exact de la compétition, et l'action est irréversible.
La liste des compétitions rappelle au bout de 2 ans, puis 5 ans. Rien n'est
jamais supprimé automatiquement (DECISIONS.md ADR-051).

## Vidéos de voie

Une voie peut porter un lien YouTube/Vimeo, ou une **vidéo téléversée**
(voies → Modifier → « Choisir une vidéo »). MP4, MOV et WebM seulement, vérifiés
sur le contenu réel du fichier et non sur l'extension ; pas de transcodage, donc
le codec n'est pas contrôlé (H.264/AAC recommandé). L'envoi se fait par morceaux
de 8 Mo et **reprend tout seul** après une coupure ; fermer l'onglet ne perd pas
les octets déjà envoyés : rechoisir le même fichier reprend. Taille maximale :
`VIDEO_MAX_BYTES` (200 Mo par défaut). Les fichiers sont sur le volume Docker
`uploads-data` — à inclure dans vos sauvegardes. Voir DECISIONS.md ADR-052 et
ADR-058 (le stockage S3 n'est pas livré : `STORAGE_DRIVER=s3` échoue
explicitement).

## Photo annotée de la voie

Une voie peut porter **une photo**, sur laquelle l'organisateur place les prises
numérotées. Elle se choisit **dès la création de la voie** (champ « Photo de la voie
(optionnelle) » du formulaire « Ajouter une voie ») ou plus tard (voies → Modifier →
« Choisir une photo » / « Remplacer la photo »). À la création, le déroulé est : **1.** choisir
l'image ; **2.** décider de la recadrer ou non (« Recadrer la photo » ou « Continuer sans
recadrer ») ; **3.** placer les prises dessus. **Le nombre de prises de la voie est alors celui
des prises placées** : il remplace le champ « Nombre de prises », même déjà rempli (ADR-068).
Revenir au recadrage depuis le placement efface les prises, après confirmation. « Ajouter »
enregistre la voie, puis sa photo, puis ses prises ; si le réseau lâche en route, rien n'est
perdu et un second clic termine sans doublon. Le recadrage est un
écran dédié : un rectangle libre dont on tire les quatre coins (aussi aux flèches du clavier),
avec zoom ×1 / ×2 / ×3 pour être précis ; « Retirer le recadrage » revient à la photo entière.
La zone est découpée dans la photo d'origine **avant** la réduction (ADR-067). La photo est réduite et
ré-encodée en JPEG **dans le navigateur** (côté long 1600 px, environ 300 Ko :
orientation appliquée, GPS retiré) ; le serveur n'accepte que du JPEG, reconnu à
ses octets. Toucher la photo pose une prise, la glisser la déplace, « Renuméroter
de bas en haut » classe les prises d'après leur hauteur (à vérifier sur une
traversée ou un dévers). **« Agrandir la photo »** ouvre le placement en plein
écran, avec zoom ×1 / ×2 / ×3 — à toutes les largeurs, téléphone compris, parce
que c'est devant le mur qu'on en a le plus besoin (ADR-077). L'aperçu sur lequel
on annote à la création fait 1280 px de côté long, et non plus 640. Les modifications ne partent qu'à « Enregistrer les
prises ». Une prise ne peut pas porter un numéro supérieur au nombre de prises de
la voie. Remplacer la photo **efface** les prises. **Dès qu'un passage existe sur
la voie, la photo et les prises sont figées**, comme le nombre de prises
(ADR-066, ADR-067, ADR-068 et ADR-004).

« Imprimer les fiches voie » (en haut de l'onglet Voies) donne un PDF, une page A4
par voie ayant une photo, avec la photo annotée ; « Imprimer la fiche de cette
voie » n'en imprime qu'une.

Côté juge, l'écran de saisie a un bouton **Voir la voie** : un panneau plein écran
glisse depuis la droite, avec zoom ×1 / ×2 / ×3. La photo est **gardée dans le
téléphone** (IndexedDB) au moment de l'amorçage : elle s'affiche sans réseau. Si
elle n'a pas encore été téléchargée, le panneau le dit et la saisie continue. Les
photos sont sur le volume `uploads-data`, comme les vidéos. Voir DECISIONS.md
ADR-066.

## Espace organisateur sur grand écran

À partir de 1024 px de large (`lg`), l'espace organisateur prend la largeur de l'écran
(ADR-072) ; en dessous, rien ne change et les 360 px restent la référence.

- `BrandShell` accepte `width="wide"` : en-tête et contenu bornés à `max-w-screen-2xl`. Les
  pages d'entrée et publiques gardent `narrow`, la valeur par défaut.
- Sur la page d'une compétition, les onglets deviennent une **barre latérale** groupée
  *Préparer / Vérifier / Jour J*, et l'en-tête (retour, nom, lieu, date, lien vers la page
  publique) reste **collant**. C'est le même composant `Tabs` de `packages/ui`, en
  `orientation="vertical"` : mêmes rôles ARIA, flèches ↑/↓ comme ←/→, le focus suit.
- **L'onglet est dans l'adresse** : `/competitions/:id/routes`, `/competitors`,
  `/pilotage?section=conflicts`, etc. (identifiants
  dans `apps/web/src/lib/competition-tabs.ts`). Rechargement, lien profond et bouton
  « précédent » fonctionnent ; un segment inconnu, ou `rounds` hors format à phases, ramène
  à Infos.
- **Les listes sont des tableaux** : compétiteurs, voies, juges, catégories, liste des
  compétitions et corbeille passent par le composant `DataList` de `packages/ui` — cartes
  en dessous de 1024 px, tableau à en-tête collant au-dessus (ADR-074). Une colonne s'y
  décrit une seule fois et sert aux deux rendus ; c'est l'écran qui choisit sa disposition,
  il n'y a jamais deux rendus dans le DOM.
- **Les en-têtes trient** (compétiteurs, juges, liste, corbeille), avec `aria-sort`. Sur la
  liste des compétitions ils commandent le tri qui vit déjà dans l'adresse, et le sélecteur
  « Trier par » s'efface. Voies et catégories ne se trient pas : leur ordre est celui que
  vous posez avec les flèches.
- **Une ligne d'ajout rapide** en tête du tableau des compétiteurs : `Entrée` ajoute et rend
  le focus au prénom, `Échap` abandonne la ligne. La catégorie et le club sont conservés
  d'une saisie à l'autre — on entre une catégorie entière sans toucher la souris. En dessous
  de 1024 px, c'est le formulaire en carte d'avant.
- **Densité compacte à la souris** (ADR-073) : les lignes de tableau descendent à ~40 px
  sous `@media (pointer: fine) and (not (any-pointer: coarse))`. Dès qu'un doigt est
  possible — téléphone, tablette, portable à écran tactile — tout revient à 48 px, et les
  écrans juge et public ne sont jamais concernés.
- Le tableau des compétiteurs ne montre l'année de naissance, le club et le numéro de
  licence qu'à partir de 1280 px : en dessous, neuf colonnes rendraient les noms illisibles.
  Même règle pour le secteur, la couleur et le média d'une voie, et pour le PIN et le
  dernier accès d'un juge.
- **Voies et juges s'éditent à côté de leur liste à partir de 1440 px** (ADR-075) : la liste
  à gauche, l'éditeur de la voie ou la fiche du juge à droite, collés en haut. Le seuil est
  mesuré, pas choisi : en dessous, les colonnes du tableau n'ont plus la place et passeraient
  sous le panneau. Entre 1024 et 1440 px, c'est le tableau seul, l'éditeur en dessous.
  - **La sélection est dans l'adresse** (`?route=…`, `?judge=…`) : recharger la page en
    pleine annotation ne referme pas la voie ouverte. Un identifiant inconnu est ignoré
    sans bruit. Changer de voie est refusé tant qu'une création en cours n'a pas fini
    d'envoyer sa photo ou ses prises.
  - **La fiche d'un juge** montre son statut, ses voies, son PIN, son lien d'accès et son
    **QR code**, dessiné dans le navigateur (ADR-076) — c'est le seul endroit qui puisse le
    faire quand la compétition ne conserve pas les accès en clair. Aucun QR pour un juge
    révoqué. « Voir l'accès », « Régénérer le PIN » et « Révoquer » vivent alors dans la
    fiche, plus sur la ligne.
- **Le pilotage jour J devient un poste de travail à partir de 1024 px** (ADR-082) : dans
  « Vue d'ensemble », les alertes, la progression en barres et les compétiteurs en attente
  occupent la colonne principale, pendant qu'un rail collant à droite montre les conflits à
  trancher (avec le nom du compétiteur et la voie), l'état des juges et les cinq dernières
  actions du journal. Chaque panneau mène à sa sous-section.
  - **L'onglet Pilotage porte une pastille** : le nombre de conflits non résolus en rouge —
    ils retiennent une publication — ou, à défaut, le nombre d'alertes en ambre. « Prêt à
    démarrer ? » porte le nombre de contrôles en échec. L'en-tête collant affiche
    l'avancement global (`128 / 240 passages`), lisible depuis n'importe quel onglet.
  - **Une grille compétiteurs × voies** remplace, dans « Voies », le choix d'une voie à la
    fois : on choisit une catégorie (et un tour s'il y en a plusieurs), et chaque case ouvre
    la correction ou la saisie de secours du passage qu'elle désigne. Une case **en conflit**
    est colorée, libellée « à trancher » et mène à l'onglet Conflits : elle ne se confond
    jamais avec une case vide. La sélection vit dans l'adresse (`?pair=…`). Côté API :
    `GET .../ascents/matrix?roundId=&categoryId=` (ADR-083), borné au couple (tour,
    catégorie). En dessous de 1024 px, la liste par voie du Lot 8 est conservée telle quelle.
  - **Les conflits sont en vis-à-vis** : les valeurs candidates à gauche (trois de front
    au-delà de 1280 px), les actions à droite, et une phrase dit sur quoi les saisies
    diffèrent.
  - **Le journal est un tableau triable**, avec un filtre par dates en plus du type et de
    l'acteur ; le détail brut n'apparaît qu'au-delà de 1280 px.

## Membres de l'organisation

Menu → **Membres de l'organisation** (`/organization/members`). Chaque compte y
apparaît avec son rôle et son statut. Un **propriétaire** invite un membre (nom,
e-mail, rôle) : la personne reçoit un lien valable 7 jours, choisit son mot de
passe sur `/accept-invite` et retrouve toutes les compétitions de
l'organisation. Il peut relancer ou annuler une invitation, changer un rôle,
désactiver un compte (connexion refusée, sessions fermées, rien n'est effacé) et
le réactiver. L'organisation garde toujours au moins un propriétaire actif, et
personne ne désactive son propre compte (ADR-087).

## Fiche de l'organisation

Menu → **Fiche de l'organisation** (`/organization`). Un **propriétaire** y renseigne
le type (club, salle ou autre), une description, l'adresse et un contact public
(e-mail, téléphone, site web) ; les autres membres voient la fiche telle que le
public la verra. Elle apparaît en encart, sous le classement, sur la page publique de
chaque compétition (ADR-088).

- **Adresse** : autocomplétée par la Base Adresse Nationale
  (`data.geopf.fr/geocodage`, appelée depuis le navigateur, France seulement).
  Choisir une proposition affiche une carte ; une adresse tapée sans choisir (ou
  quand le service ne répond pas) est gardée telle quelle, sans carte.
- **Carte** : Leaflet sur les tuiles Plan IGN (`data.geopf.fr/wmts`), chargée
  seulement sur les écrans qui en montrent une, hors précache du service worker.
  Hors ligne, l'adresse reste affichée avec le lien « Itinéraire » (Google Maps).
- **CSP** : `connect-src` et `img-src` n'ouvrent que `https://data.geopf.fr`
  (`infra/docker/Caddyfile`).
- **Photos** (ADR-090) : jusqu'à 6, ré-encodées en JPEG dans le navigateur comme la photo
  de voie (1600 px, GPS retiré), avec une description facultative (texte alternatif). On
  en choisit plusieurs d'un coup, on les ordonne avec « Avancer » / « Reculer » ; « Supprimer »
  laisse un bandeau « Annuler » jusqu'à l'action suivante. Elles sont enregistrées dès
  l'envoi, hors du bouton « Enregistrer la fiche ». Dans l'encart public : des vignettes,
  chargées quand on descend jusqu'à elles, qui s'ouvrent en grand. Stockées sous
  `organizations/<id>/photos/` ; un fichier supprimé reste sur le disque (purge à venir,
  `TODO.md`).

**Lieu des compétitions** (ADR-089) : à la création comme dans l'onglet Infos, le choix
« Lieu de l'organisation » recopie le nom et l'adresse de la fiche ; « Autre lieu » fait
saisir un nom et une adresse (facultative, même autocomplétion). C'est une copie : modifier
la fiche ne change pas les compétitions déjà créées. La page publique montre l'adresse et
une carte sous le classement ; l'encart de l'organisation ne répète pas la carte quand
c'est le même endroit. La sauvegarde JSON porte l'adresse (facultative : les anciennes
sauvegardes s'importent toujours).

## Liste des compétitions et corbeille

La connexion mène directement à **Mes compétitions** (`/competitions`,
ADR-080). Le menu ☰ en haut à droite de chaque page organisateur (liste,
détail, création, corbeille) donne « Accueil », « Mes compétitions » et
« Se déconnecter » — seul point d'accès à la déconnexion hors de `/`.

**Mes compétitions** se recherche (nom ou lieu, sans tenir compte des accents ni
de la casse), se filtre (statut, date de début, « À venir ou en cours » /
« Passées ») et se trie (date, nom, statut). La vue est dans l'adresse de la page
(`?q=&status=&from=&to=&when=&sort=&dir=`) : elle survit à un rechargement et se
partage. Le filtrage se fait dans le navigateur (DECISIONS.md ADR-062).

Supprimer se fait **en deux temps** (ADR-063). **Sélectionner**, cocher, puis
**Mettre à la corbeille** : sans confirmation, réversible, et refusé pour une
compétition « En cours ». La page **Corbeille** permet de **restaurer**, ou de
**supprimer définitivement** (une confirmation) : fichiers et lignes de toute la
compétition disparaissent, seule une trace sans donnée personnelle reste
(`competition_deletion_log`). Tout organisateur de l'organisation peut le faire. Une
compétition à la corbeille n'est plus accessible aux juges ni au public ; les
saisies d'un juge restent dans son téléphone et remontent après restauration. Rien
n'est supprimé automatiquement. La purge RGPD (ci-dessus) est une autre action.

## Exports et sauvegarde

L'onglet **Exports** d'une compétition télécharge les résultats en PDF (A4,
une catégorie par page, détail par voie, « provisoire » tant qu'un tour n'est
pas publié) et en CSV (séparateur `;`, ouvrable dans Excel), par catégorie ou
pour toutes. Ils viennent du même calcul que la page publique et ne portent que
ce qu'elle montre : nom, prénom, club, dossard. Une **sauvegarde JSON** contient
toute la compétition, historique des passages compris, sans aucun accès juge
(DECISIONS.md ADR-056) ; **Mes compétitions → Importer une sauvegarde** la
recrée comme une nouvelle compétition, après un aperçu obligatoire. Les juges
sont restaurés révoqués : il faut recréer des accès et réimprimer les QR codes.

## Tests

- `pnpm test` couvre les paquets purs (`contracts`, `ui`, `scoring`, `sync`)
  sans dépendance externe, et les intégrations (`db`, `api`) via
  Testcontainers (Postgres 16 éphémère, un conteneur par run). `apps/web`
  utilise `fake-indexeddb` pour les tests touchant Dexie (file de
  synchronisation juge).
- `packages/scoring` (le moteur de cotation, voir `RULES.md`) exige 100 %
  de couverture de branches : `pnpm --filter @climbcontest/scoring test -- --coverage`.
- Vingt tests Playwright end-to-end (`e2e/`) : la page d'accueil publique en
  anonyme et en connecté (aussi à 360 px) ; connexion d'un compte déjà
  activé jusqu'à « Mes compétitions » ; inscription → vérification par e-mail (via
  Mailpit) → connexion ; un juge note un passage et le corrige (en ligne) ;
  un juge note 10 passages hors ligne, ferme/rouvre l'onglet, puis se
  resynchronise dans l'ordre de saisie ; deux appareils saisissent des
  valeurs différentes pour le même passage hors ligne et un conflit est
  signalé au retour du réseau ; un passage noté par le juge apparaît en
  direct dans le classement public d'un second onglet, sans rechargement ;
  un organisateur résout un conflit, corrige un passage et publie un tour
  depuis l'onglet Pilotage ; une compétition en phases jouée de bout en bout
  (qualification à deux voies, demi-finale, finale, classement final avec
  contre-performance) ; les exports PDF/CSV/JSON et le réimport d'une
  sauvegarde ; le téléversement d'une vidéo, avec coupure réseau et reprise ; la photo annotée d'une voie, de l'organisateur au juge hors ligne (aussi à 360 px) ; le choix, le recadrage et l'annotation de la photo à la création de la voie, avec le nombre de prises déduit (aussi à 360 px) ; le maître–détail des voies et des juges à 1440 px, la sélection dans l'adresse et l'annotateur en plein écran (aussi à 360 px) —
  la purge des données personnelles ; le mode dégradé quand le serveur est injoignable ; la recherche dans la liste, la corbeille, la restauration et la suppression définitive d'une compétition (aussi à 360 px) ; voir `e2e/README.md` pour les lancer.
