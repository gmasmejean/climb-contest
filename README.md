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

### Mise à jour de l'application

Après un redéploiement (`docker compose up --build -d`), un navigateur qui
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
**propriétaire** du club peut exporter tout ce qui identifie une personne, puis
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
numérotées. La photo se choisit **dès la création de la voie** (champ « Photo de la
voie (optionnelle) » du formulaire « Ajouter une voie ») ou plus tard (voies →
Modifier → « Choisir une photo » / « Remplacer la photo ») ; les prises se placent
ensuite, voie ouverte en modification. Avant l'envoi, « Recadrer la photo » ouvre un
écran de recadrage : un rectangle libre dont on tire les quatre coins (aussi aux
flèches du clavier), avec zoom ×1 / ×2 / ×3 pour être précis ; l'aperçu montre
exactement ce qui sera envoyé, « Retirer le recadrage » revient à la photo entière.
La zone est découpée dans la photo d'origine **avant** la réduction (ADR-067). La photo est réduite et
ré-encodée en JPEG **dans le navigateur** (côté long 1600 px, environ 300 Ko :
orientation appliquée, GPS retiré) ; le serveur n'accepte que du JPEG, reconnu à
ses octets. Toucher la photo pose une prise, la glisser la déplace, « Renuméroter
de bas en haut » classe les prises d'après leur hauteur (à vérifier sur une
traversée ou un dévers). Les modifications ne partent qu'à « Enregistrer les
prises ». Une prise ne peut pas porter un numéro supérieur au nombre de prises de
la voie. Remplacer la photo **efface** les prises. **Dès qu'un passage existe sur
la voie, la photo et les prises sont figées**, comme le nombre de prises
(ADR-066, ADR-067 et ADR-004).

« Imprimer les fiches voie » (en haut de l'onglet Voies) donne un PDF, une page A4
par voie ayant une photo, avec la photo annotée ; « Imprimer la fiche de cette
voie » n'en imprime qu'une.

Côté juge, l'écran de saisie a un bouton **Voir la voie** : un panneau plein écran
glisse depuis la droite, avec zoom ×1 / ×2 / ×3. La photo est **gardée dans le
téléphone** (IndexedDB) au moment de l'amorçage : elle s'affiche sans réseau. Si
elle n'a pas encore été téléchargée, le panneau le dit et la saisie continue. Les
photos sont sur le volume `uploads-data`, comme les vidéos. Voir DECISIONS.md
ADR-066.

## Liste des compétitions et corbeille

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
(`competition_deletion_log`). Tout organisateur du club peut le faire. Une
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
- Dix-neuf tests Playwright end-to-end (`e2e/`) : connexion d'un compte déjà
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
  contre-performance) ; les exports PDF/CSV/JSON et le réimport d'une
  sauvegarde ; le téléversement d'une vidéo, avec coupure réseau et reprise ; la photo annotée d'une voie, de l'organisateur au juge hors ligne (aussi à 360 px) ; le choix et le recadrage de la photo à la création de la voie (aussi à 360 px) —
  la purge des données personnelles ; le mode dégradé quand le serveur est injoignable ; la recherche dans la liste, la corbeille, la restauration et la suppression définitive d'une compétition (aussi à 360 px) ; voir `e2e/README.md` pour les lancer.
