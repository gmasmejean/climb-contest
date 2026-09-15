# SPEC.md — Spécification fonctionnelle et technique

**Projet :** application de gestion de compétitions d'escalade de difficulté
**Version :** 0.2 — arbitrages du Lot 0 intégrés, voir `DECISIONS.md`
**Statut :** les points encore marqués 🟡 sont ouverts. La plupart ont été
arbitrés pendant le Lot 0 (ADR-001 à ADR-016 dans `DECISIONS.md`) ; seule la
politique RGPD reste à trancher avant le Lot 9.

---

## 1. Glossaire — vocabulaire du domaine

Ce tableau fait autorité. Le code utilise la colonne « Terme code », l'interface
la colonne « Terme métier ». Aucun synonyme n'est introduit ailleurs.

| Terme métier (FR) | Terme code (EN) | Définition |
|---|---|---|
| Club | `club` | Structure organisatrice. Possède des utilisateurs et des compétitions. |
| Compétition | `competition` | Un événement, à une date, dans un lieu. |
| Catégorie | `category` | Groupe de compétiteurs comparés entre eux (ex. « U16 Femme »). |
| Compétiteur | `competitor` | Une personne inscrite, rattachée à exactement une catégorie. |
| Dossard | `bib` | Numéro porté par le compétiteur, unique dans la compétition. |
| Voie | `route` | Un itinéraire équipé, numéroté, ouvert pour une ou plusieurs catégories. |
| Prise | `hold` | Élément de préhension. Numérotée de 1 (bas) à N (haut) sur la voie. |
| Tour / Manche | `round` | Phase de la compétition : qualification, demi-finale, finale. |
| Passage | `ascent` | La tentative d'un compétiteur sur une voie, dans un tour. |
| Juge | `judge` | Personne qui note les passages sur les voies qui lui sont assignées. |
| Hauteur atteinte | `height` | Résultat d'un passage : numéro de prise + modificateur. |
| Top | `top` | Le compétiteur a mousquetonné la dégaine finale. |
| Cotation / Notation | `scoring` | Conversion d'un passage en valeur comparable. |
| Classement | `ranking` | Ordre des compétiteurs d'une catégorie. |
| Contre-performance | `countback` | Départage par le résultat d'un tour antérieur. |
| Ouvreur | `routesetter` | Hors périmètre v1. |

---

## 2. Périmètre

### Dans le périmètre (v1)

- Discipline : **difficulté uniquement**.
- Deux formats de compétition, choisis à la création :
  - **Contest** — chaque compétiteur grimpe librement N voies parmi celles de sa
    catégorie ; on additionne ses M meilleures performances.
  - **Phases** — qualification(s), puis demi-finale et/ou finale, avec des
    compétiteurs qualifiés d'un tour au suivant.
- Trois publics : organisateur, juge, public.
- Une PWA unique, mobile-first, fonctionnelle hors ligne côté juge.
- Classement public en temps réel.
- Langue de l'interface : français.

### Hors périmètre (explicitement, v1)

- Bloc et vitesse. Le modèle de données doit les rendre **possibles plus tard**
  sans migration douloureuse, mais aucun code ne les implémente.
- Inscriptions en ligne par les compétiteurs eux-mêmes.
- Paiement, licences, vérification fédérale.
- Multi-langue.
- Gestion des ouvreurs et des cotations d'ouverture.
- Différenciation entre « public » et « compétiteur » : ils partagent la même
  interface en lecture seule.
- Application native / stores.

---

## 3. Acteurs et parcours

### 3.1 Organisateur

Compte nominatif (e-mail + mot de passe), rattaché à un club.

**Inscription (ADR-017, Lot 1) :** ouverte à tous — n'importe qui peut créer
un compte via `/register`, ce qui crée à la fois un nouveau club et son
premier compte (`role = 'owner'`). Le compte est activé après validation de
l'e-mail (lien envoyé, valable 24 h). Les comptes supplémentaires d'un même
club sont créés par invitation d'un `owner` (lien envoyé par e-mail, valable
7 jours, qui sert à la fois de preuve de possession de l'e-mail et de moyen
de définir le mot de passe). Validation admin des créations de club et zone
publique de recherche club/compétition : besoins identifiés, pas dans le
périmètre actuel (voir `TODO.md`).

Il peut :

**Préparer**
- créer une compétition : nom, date(s), lieu, club, format (contest ou phases) ;
- définir les catégories, soit depuis un modèle prédéfini (FFME jeunes : U12,
  U14, U16, U18, U20, Senior, Vétéran × Homme/Femme), soit en libre ;
- saisir les compétiteurs un par un, ou les importer en masse depuis un CSV
  (avec prévisualisation, détection de doublons, et rapport d'erreurs ligne à
  ligne avant validation) ;
- attribuer les dossards, manuellement ou automatiquement ;
- saisir les voies : numéro, nom optionnel, nombre de prises, catégories
  concernées, secteur/mur, couleur, vidéo d'enchaînement (lien YouTube/Vimeo ou
  fichier téléversé) ;
- déclarer les juges : nom d'affichage, voies assignées ; le système génère pour
  chacun un lien d'accès et un QR code, plus un code PIN à 6 chiffres ;
- imprimer une planche de QR codes (juges + accès public) au format A4.

**Piloter le jour J**
- ouvrir / suspendre / clore la compétition et chaque tour ;
- voir un tableau de bord temps réel : nombre de passages saisis, voies sans
  aucune saisie depuis X minutes, juges connectés, compétiteurs n'ayant pas
  encore grimpé, compétiteurs ayant terminé ;
- corriger un passage (avec motif obligatoire et trace dans l'historique) ;
- arbitrer un conflit de saisie (deux valeurs différentes pour le même passage) ;
- saisir un passage à la place d'un juge (secours si une tablette lâche) ;
- marquer un compétiteur absent (DNS), abandon (DNF) ou disqualifié ;
- publier / dépublier les résultats d'un tour ;
- exporter les résultats en CSV et en PDF.

### 3.2 Juge

Pas de compte. Accès en deux temps :

1. **Le lien** — scan d'un QR code ou saisie d'une URL de la forme
   `/j/<token>`. Le token est un secret long, propre à ce juge et à cette
   compétition.
2. **Le PIN** — un code à 6 chiffres, communiqué oralement par l'organisateur.
   Un lien seul, photographié ou retrouvé par terre, ne permet pas de noter.

Une fois authentifié, le juge obtient une session de longue durée (durée de vie
= fin de la compétition + 12 h) stockée sur l'appareil. Il ne ressaisit pas son
PIN toutes les cinq minutes.

Son interface, volontairement pauvre :

- la liste de **ses** voies (et rien d'autre) ;
- pour une voie, la liste des compétiteurs concernés, triée par statut
  (à faire / fait), avec recherche par dossard ou par nom ;
- l'écran de saisie : un pavé numérique pour le numéro de prise, deux boutons
  de modificateur (neutre / `+`), un bouton `TOP` plein largeur, et les
  statuts `chute` / `DNS` / `DNF` ;
- un récapitulatif avant validation, parce qu'une erreur de saisie est plus
  coûteuse qu'un tap de plus ;
- après validation : confirmation visuelle immédiate, et un indicateur d'état de
  synchronisation persistant (`en attente` / `envoyé` / `confirmé`) ;
- la possibilité de corriger sa dernière saisie jusqu'à sa saisie suivante
  (n'importe quel compétiteur) ou 5 minutes après la saisie initiale, le
  premier des deux qui survient (ADR-007) ; au-delà il faut passer par
  l'organisateur.

**Le juge doit pouvoir tout faire hors ligne**, y compris au premier chargement
de la journée si la voie a été mise en cache avant.

### 3.3 Public / compétiteurs

Accès par URL publique `/c/<slug>` ou QR code, sans authentification. Lecture
seule, temps réel :

- sélecteur de catégorie ;
- le classement, mis à jour en direct, avec le détail des voies par compétiteur ;
- la liste des voies de la catégorie : numéro, nom, nombre de prises, secteur,
  et la vidéo d'enchaînement ;
- l'état d'avancement : tours ouverts, résultats publiés ou non.

Les résultats d'un tour ne sont visibles que si l'organisateur les a publiés.
Un classement provisoire peut être affiché pendant un tour, marqué comme tel.

---

## 4. Règles de cotation — difficulté

> ⚠️ Section critique. C'est ici que le projet se joue. Les règles ci-dessous
> suivent le cadre IFSC/FFME. Elles doivent être implémentées dans un paquet
> isolé, purement fonctionnel, et testées contre les scénarios du § 9.
> **Avant la mise en production, ces règles doivent être relues par un juge
> fédéral.** Ne les considère pas comme définitives.

### 4.1 Noter un passage

La performance d'un compétiteur sur une voie est la **hauteur atteinte**,
exprimée par le numéro de la plus haute prise obtenue, avec un modificateur :

| Notation | Signification |
|---|---|
| `n` | Le compétiteur a **contrôlé** la prise n : il s'en est servi pour atteindre ou stabiliser une position, ou pour freiner un mouvement dynamique. |
| `n+` | Il a contrôlé la prise n **et** amorcé un mouvement de progression contrôlé vers la prise n+1, sans la contrôler. |
| `TOP` | La dégaine finale est mousquetonnée. Valeur supérieure à toute prise. |

> **ADR-001 (Lot 0)** : le modificateur `n−` ("touché sans contrôle") a été
> écarté. Distinguer "touché sans contrôle" de "contrôlé" est un jugement fin
> et subjectif pour un bénévole non formé — source d'erreurs et de
> contestations. Seuls `n` et `n+` existent en v1. Voir `DECISIONS.md`.

Le juge saisit donc : un entier entre 1 et `hold_count`, un modificateur, ou
`TOP`. Plus un statut (ADR-010, sur le modèle athlétisme DNS/DNF) :
`valid`, `DNS` (n'a pas démarré son ascension — jamais présenté, ou présenté
puis retiré avant de commencer à grimper), `DNF` (a commencé à grimper puis
son ascension a été interrompue anormalement, ex. blessure en cours
d'ascension — à ne pas confondre avec une chute normale, notée à la hauteur
atteinte), `DSQ` (disqualifié).

**Valeur comparable** — pour ordonner sans ambiguïté, chaque passage est réduit
à un nombre :

```
score_value = 0                        si status ∈ {DNS, DNF, DSQ}
score_value = hold_count + 1           si TOP
score_value = hold_number + 0.5        si modificateur = '+'
score_value = hold_number              si modificateur = neutre
```

Ce nombre est **dérivé**, jamais saisi. Il est stocké en colonne calculée pour
permettre les tris en base, mais la source de vérité reste
`(hold_number, modifier, is_top, status)`. Voir ADR-003 dans `DECISIONS.md` :
pour qu'une colonne `GENERATED` Postgres puisse calculer `score_value` (elle
ne peut référencer que des colonnes de la même ligne), `hold_count` est
dupliqué sur `ascent` au moment de la saisie — voir § 5.

### 4.2 Classement sur une voie

Les compétiteurs d'une même catégorie sur une même voie sont ordonnés par
`score_value` décroissante.

Les égalités sont résolues dans cet ordre :

1. **Temps d'ascension**, si la compétition l'a activé : le plus rapide devant.
   (🟡 Optionnel. Rarement chronométré en club. Champ nullable.)
2. **Contre-performance** (`countback`) : le meilleur classement au tour
   précédent passe devant.
3. Si tout est identique, **ex aequo véritable** : même rang, et le rang suivant
   est décalé d'autant (1, 2, 2, 4).

### 4.3 Classement d'un tour

**Un tour à une voie** — le classement du tour est celui de la voie.

**Un tour à plusieurs voies** (typiquement : qualification sur 2 voies) — pour
chaque compétiteur, on calcule son rang sur chaque voie, puis on combine par
**moyenne géométrique des rangs** :

```
rang_combiné = (r₁ × r₂ × … × r_k) ^ (1/k)
```

Le classement du tour trie par `rang_combiné` croissant. Un compétiteur absent
sur une voie reçoit le rang le plus défavorable de cette voie (dernier ex aequo).

> C'est la méthode fédérale standard. Elle évite qu'un 1ᵉʳ + 20ᵉ soit traité
> comme deux 10ᵉ. Elle doit être implémentée exactement, pas approximée par une
> moyenne arithmétique.

### 4.4 Format « phases »

Une compétition en phases est une suite ordonnée de tours. Chaque tour a :

- un type : `qualification` | `semifinal` | `final` ;
- un style : `flash` (démonstration ou vue des autres autorisée) ou
  `onsight` (à vue, isolement) — information d'affichage en v1 ;
- une ou plusieurs voies par catégorie ;
- un nombre de qualifiés vers le tour suivant (ex. les 10 meilleurs) ;
- un état : `draft` | `open` | `closed` | `published`.

**Qualification vers le tour suivant** : les N premiers du classement du tour.
En cas d'égalité à la limite, tous les ex aequo sont qualifiés (le tour suivant
compte alors plus de participants que prévu) — c'est la règle fédérale, et c'est
plus juste qu'un tirage au sort. 🟡 À confirmer.

**Classement final** : le classement du dernier tour auquel le compétiteur a
participé. Un finaliste est toujours classé devant un demi-finaliste non
qualifié, quelle que soit sa performance en finale.

Le départage en finale se fait par contre-performance sur le tour précédent,
puis sur le tour d'avant, et ainsi de suite jusqu'aux qualifications.

### 4.5 Format « contest »

Configuré à la création : `routes_counted` (M) = nombre de voies retenues par
compétiteur, et un mode de calcul.

**Mode « somme des M meilleures »** (défaut) :

```
score_total = Σ des M plus grandes score_value du compétiteur
```

**Mode « points par prise »** — différé hors v1 (ADR-011) : chaque voie vaut un
nombre de points configurable, et la valeur obtenue est proportionnelle à la
hauteur atteinte. Décrit ici pour mémoire ; l'interface `ScoringEngine`
(§ 4.6) permet de l'ajouter plus tard sans migration, mais aucun code ne
l'implémente en v1 — ça réduit la surface de test du Lot 2.

```
points_voie = points_max × (score_value / (hold_count + 1))
```

Départage : nombre de tops, puis nombre de voies tentées (moins = mieux), puis
ex aequo.

### 4.6 Architecture du moteur de cotation

Tu as demandé que la cotation soit **configurable à terme**, avec la règle
FFME/IFSC comme seule implémentation en v1. Le moteur doit donc être une
interface, pas une fonction :

```ts
interface ScoringEngine {
  readonly id: string                       // 'ffme-difficulty-2026'
  readonly label: string                    // affiché à l'organisateur
  readonly configSchema: ZodSchema          // options exposées à la création

  scoreAscent(ascent: Ascent, route: Route): ScoreValue
  rankRoute(ascents: Ascent[], route: Route): RouteRanking
  rankRound(routeRankings: RouteRanking[], ctx: RoundContext): RoundRanking
  rankFinal(roundRankings: RoundRanking[], ctx: CompetitionContext): FinalRanking
}
```

Les moteurs sont enregistrés dans un registre. La compétition stocke
`scoring_engine_id` et un `scoring_config` en JSON validé par le schéma du
moteur. **Un seul moteur est implémenté en v1** — mais la frontière existe dès
le premier jour, sinon elle n'existera jamais.

Le même paquet est utilisé côté serveur (calcul officiel) et côté client
(affichage optimiste hors ligne). Le serveur fait autorité.

---

## 5. Modèle de données

PostgreSQL. Clés primaires UUID v7 (ordonnées dans le temps, pratiques pour
l'index et pour la génération côté client hors ligne). Toutes les tables ont
`created_at`, `updated_at`. Suppression logique (`deleted_at`) sur les entités
métier, jamais de `DELETE` physique sur des données de compétition.

```
club
  id, name, slug, created_at

user                                   -- organisateurs uniquement
  id, club_id → club, email (unique), password_hash (nullable),
  display_name, role ('owner' | 'organizer'), last_login_at
  email_verified_at (nullable)          -- ADR-017 : null = connexion refusée
  invited_by_user_id (nullable) → user
  pending_token_hash (nullable)         -- ADR-017 : vérification e-mail ou
  pending_token_purpose (nullable:      -- invitation — un seul mécanisme
    'email_verification' | 'invitation')
  pending_token_expires_at (nullable)

competition
  id, club_id → club
  name, venue, starts_on, ends_on
  discipline ('difficulty')             -- extensible : 'boulder', 'speed'
  format ('contest' | 'phases')
  scoring_engine_id, scoring_config (jsonb)
  status ('draft' | 'open' | 'running' | 'closed' | 'archived')
  public_slug (unique)                  -- URL publique, non devinable
  timing_enabled (bool)                 -- chronométrage des passages
  created_by → user

category
  id, competition_id → competition
  label                                 -- « U16 Femme »
  sex ('M' | 'F' | 'X')
  birth_year_min, birth_year_max (nullable)
  display_order
  UNIQUE (competition_id, label)

competitor
  id, competition_id → competition, category_id → category
  bib (int), first_name, last_name, birth_year (nullable),
  club_name (nullable), license_number (nullable),
  status ('registered' | 'present' | 'withdrawn' | 'disqualified')
  UNIQUE (competition_id, bib)

route
  id, competition_id → competition
  number (int), name (nullable)
  hold_count (int, > 0)
  sector (nullable), color (nullable)
  video_url (nullable), video_asset_id (nullable) → asset
  notes (nullable)
  UNIQUE (competition_id, number)

route_category                          -- une voie sert 1..n catégories
  route_id → route, category_id → category
  PRIMARY KEY (route_id, category_id)

round
  id, competition_id → competition
  type ('qualification' | 'semifinal' | 'final')
  style ('flash' | 'onsight')
  display_order (int)
  qualifying_count (nullable int)       -- nb de qualifiés vers le tour suivant
  status ('draft' | 'open' | 'closed' | 'published')
  UNIQUE (competition_id, display_order)

round_route                             -- quelles voies dans quel tour, pour qui
  round_id → round, route_id → route, category_id → category
  PRIMARY KEY (round_id, route_id, category_id)

judge
  id, competition_id → competition
  display_name
  access_token_hash                     -- le token en clair n'existe qu'une fois
  access_token_prefix                   -- 8 car. pour retrouver la ligne
  pin_hash                              -- argon2id
  pin_attempts (int), locked_until (nullable)
  revoked_at (nullable)
  last_seen_at (nullable)

judge_route                             -- assignations
  judge_id → judge, route_id → route
  PRIMARY KEY (judge_id, route_id)

ascent                                  -- LE cœur du système
  id (uuid v7, généré par le CLIENT pour l'idempotence hors ligne)
  competition_id, round_id → round, route_id → route,
  competitor_id → competitor
  hold_number (nullable int)
  hold_count (int, not null)            -- ADR-003 : copie de route.hold_count
                                         -- au moment de la saisie (une colonne
                                         -- GENERATED ne peut référencer que la
                                         -- même ligne)
  modifier ('none' | 'plus')            -- ADR-001 : 'minus' retiré
  is_top (bool)
  status ('valid' | 'dns' | 'dnf' | 'dsq')
  score_value (numeric, GENERATED ALWAYS AS (...) STORED)  -- dérivé de
                                         -- hold_number, modifier, is_top,
                                         -- status, hold_count — jamais saisi
  climb_time_ms (nullable int)
  recorded_by_judge_id (nullable) → judge
  recorded_by_user_id (nullable) → user -- saisie de secours par l'orga
                                         -- CHECK : exactement un des deux non nul
  recorded_at (timestamptz)             -- heure de l'ÉVÉNEMENT, pas de l'envoi
  synced_at (timestamptz)               -- heure d'arrivée serveur
  device_id (text)                      -- quel appareil a saisi
  superseded_by (nullable) → ascent     -- correction : chaînage, pas écrasement
  conflict_group (nullable uuid)        -- marque une saisie contradictoire
  UNIQUE (round_id, route_id, competitor_id)
    WHERE superseded_by IS NULL AND conflict_group IS NULL  -- ADR-002 : une
                                         -- ligne en conflit sort temporairement
                                         -- de la contrainte d'unicité

ascent_event                            -- journal d'audit, append-only
  id, ascent_id → ascent
  event_type ('created' | 'corrected' | 'voided' | 'conflict_resolved')
  actor_type ('judge' | 'organizer' | 'system'), actor_id
  payload (jsonb)                       -- avant / après
  reason (nullable text)
  created_at

asset                                   -- vidéos téléversées
  id, competition_id → competition
  kind ('video'), storage_key, mime_type, size_bytes,
  duration_ms (nullable), uploaded_by → user

session                                 -- refresh tokens organisateurs
  id, user_id → user, refresh_token_hash, user_agent, ip,
  expires_at, revoked_at
```

### Points d'attention sur le modèle

- **Le format contest a lui aussi un `round`.** Une compétition en contest crée
  un tour unique implicite (`type = 'qualification'`, `display_order = 0`), ce
  qui évite un `round_id` nullable et un deuxième chemin de code partout. La
  distinction entre les deux formats ne vit que dans le moteur de cotation.
- **L'`id` d'un `ascent` est généré côté client.** C'est ce qui rend la
  synchronisation hors ligne idempotente : un renvoi du même passage est un
  `INSERT … ON CONFLICT (id) DO NOTHING`, pas un doublon.
- **`recorded_at` ≠ `synced_at`.** L'ordre chronologique réel des passages est
  celui du terrain, pas celui de la remontée réseau. Les deux sont stockés.
- **Une correction ne modifie pas la ligne** : elle crée un nouvel `ascent` et
  renseigne `superseded_by` sur l'ancien. On peut rejouer toute la compétition.
- **L'index unique partiel** garantit un seul passage actif par
  (tour, voie, compétiteur), tout en autorisant l'historique et les conflits
  (voir ADR-002 : la condition inclut `AND conflict_group IS NULL`).
- **Conflit** : si deux appareils insèrent deux `ascent` différents pour le
  même triplet, le serveur détecte le conflit avant l'écriture (ou intercepte
  l'échec de contrainte), enregistre les deux lignes avec un `conflict_group`
  commun (elles sortent temporairement de la contrainte d'unicité), et alerte
  l'organisateur, qui tranche. **Ne jamais perdre silencieusement une saisie
  de juge.**

---

## 6. Architecture technique — proposition de référence

> Cette section est une **proposition à challenger**, pas une décision. Elle
> reflète des contraintes explicites : TypeScript partout, pas de verrouillage
> fournisseur, hors ligne robuste, maintenable seul, auto-hébergeable.

### 6.1 Stack proposée

| Couche | Choix | Pourquoi |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Types partagés client/serveur sans publication de paquets. |
| Front | Vue 3 + Vite + TypeScript | Écosystème PWA mature (`vite-plugin-pwa`), courbe connue. |
| État serveur | TanStack Query (Vue) | Cache, revalidation, mutations optimistes — la moitié du travail hors ligne. |
| Stockage local | Dexie (IndexedDB) | File d'attente de synchronisation et cache des données de voie. |
| Service worker | Workbox via `vite-plugin-pwa` | Precache de l'app, stratégies par route. |
| UI | Tailwind + composants maison | Pas de librairie lourde ; les besoins sont spécifiques (pavé numérique, gros boutons). |
| Back | Hono sur Node 22 | Léger, standard Web (Request/Response), tourne partout — Node, Bun, Deno, edge. |
| Validation | Zod, schémas partagés | Une seule définition pour le type, la validation et le formulaire. |
| Base | PostgreSQL 16 | Rien d'exotique. Hébergeable n'importe où. |
| Accès base | Drizzle ORM + migrations SQL | Typé, proche du SQL, migrations versionnées et réversibles. |
| Temps réel | SSE (`text/event-stream`) natif Hono | Un flux par compétition, unidirectionnel — c'est exactement le besoin. Reconnexion automatique gratuite, traverse les proxys mieux que WebSocket. |
| Fichiers | Interface `StorageAdapter` | Implémentations `local-disk` et `s3-compatible`. Aucune dépendance directe à un fournisseur. |
| Auth orga | JWT maison (jose) + argon2id, refresh en cookie httpOnly | Contrôle total, pas de vendor lock-in. |
| Tests | Vitest + Playwright | Unitaires sur la cotation, e2e sur les parcours critiques. |
| Déploiement | Docker Compose (app + Postgres + Caddy) | Fonctionne sur un VPS à 5 €, sur un portable dans la salle, ou chez n'importe quel PaaS. |

**Note sur le temps réel :** SSE plutôt que WebSocket est un choix assumé. Le
flux est à sens unique (serveur → public), SSE se reconnecte tout seul, passe
les proxys d'entreprise, et ne demande aucune infrastructure supplémentaire.
Si un besoin bidirectionnel apparaît, on migrera — la frontière est fine.

**Note sur l'absence de Supabase :** Postgres nu + Drizzle donne la même chose
sans lier le schéma, l'auth et le temps réel à un fournisseur unique. Le coût
est une poignée d'heures au démarrage ; le bénéfice est la portabilité.

**Note sur la portée de TanStack Query (ADR-012) :** TanStack Query gère le
cache et les mutations pour les écrans organisateur et public. L'interface
**juge** n'y passe pas — IndexedDB (Dexie) est l'unique source de vérité côté
juge, pilotée par `packages/sync`. Le "network-first avec repli cache" de
TanStack Query ne donne pas les garanties de durabilité exigées par
`CLAUDE.md` (survie à la fermeture d'onglet, au redémarrage du téléphone,
idempotence par lot).

**Note sur les requêtes de classement (ADR-013) :** Drizzle reste utilisé
pour le schéma, les migrations et le CRUD organisateur. La requête qui
alimente `GET /public/:slug/rankings` (chemin chaud, cible 300 spectateurs
simultanés) est écrite en SQL explicite, pas via l'API relationnelle de
Drizzle — conforme à `CLAUDE.md` "pas d'ORM magique sur le chemin critique".

**Note sur le pont écriture → SSE (ADR-014) :** la diffusion `ranking_updated`
passe par `LISTEN/NOTIFY` Postgres, pas par un `EventEmitter` Node en
mémoire — ça reste correct si l'API tourne en plusieurs workers, sans
introduire de dépendance Redis.

### 6.2 Arborescence

```
apps/
  api/                 Hono, routes HTTP, SSE, jobs
  web/                 PWA Vue — les trois interfaces
packages/
  scoring/             MOTEUR DE COTATION — pur, sans dépendance, très testé
  sync/                machine à états de la file de synchronisation hors
                        ligne (pending/sent/acked/conflict), pure, testée
                        sans Vue ni IndexedDB réel — voir ADR-014
  contracts/           schémas Zod + types partagés + routes typées
  db/                  schéma Drizzle, migrations, seeds
  ui/                  composants partagés
infra/
  docker/              Dockerfile, compose, Caddyfile
  scripts/             sauvegarde, restauration, import CSV
```

`packages/scoring` ne dépend de rien — ni de la base, ni de Zod, ni du réseau.
Des fonctions, des types, des tests. C'est la pièce qu'on doit pouvoir relire
intégralement avec un juge fédéral à côté de soi.

### 6.3 Stratégie hors ligne

Le juge est le seul acteur avec un vrai besoin hors ligne. Public et
organisateur peuvent exiger le réseau (avec dégradation propre).

**À l'authentification du juge**, l'application télécharge et persiste :
- ses voies, avec leur `hold_count` ;
- la liste complète des compétiteurs concernés par ses voies ;
- les tours ouverts et leur configuration ;
- les passages déjà saisis sur ses voies.

**Pendant la compétition**, chaque saisie :
1. génère un `id` (UUID v7) côté client ;
2. est écrite dans IndexedDB avec l'état `pending` ;
3. met à jour l'interface **immédiatement** (optimiste) ;
4. est poussée dans une file d'envoi.

**La file** envoie par lots, avec repli exponentiel, et survit à la fermeture de
l'onglet et au redémarrage du téléphone. Chaque envoi est idempotent.
L'état d'un élément passe `pending` → `sent` → `acked`, ou → `conflict`.

**Réconciliation** : le serveur répond à chaque lot par un état par élément.
En cas de conflit (un autre appareil a déjà saisi ce passage), le client ne
supprime rien : il marque l'élément `conflict`, l'affiche au juge avec les deux
valeurs, et alerte l'organisateur qui tranche.

**Règle d'or :** une donnée saisie par un juge n'est jamais supprimée du client
avant d'avoir été acquittée par le serveur. Jamais.

### 6.4 Sécurité

- **Organisateur** : access token JWT court (15 min) en mémoire, refresh token
  opaque en cookie `httpOnly`, `Secure`, `SameSite=Lax`, rotatif avec détection
  de réutilisation. Mots de passe en argon2id.
- **Juge** : `/j/<token>` → le token est comparé par hachage. Ensuite, PIN à 6
  chiffres, argon2id, **limité à 5 tentatives puis blocage 15 minutes**,
  compteur par juge et par IP. Le succès délivre un JWT de portée restreinte :
  il ne permet que de lire et écrire des passages sur les voies assignées, pour
  cette compétition, jusqu'à la fin de l'événement. L'organisateur peut révoquer
  un juge à tout moment.
- **Public** : `public_slug` non devinable (22 caractères base62). Aucune donnée
  personnelle au-delà de ce qui est affiché : nom, prénom, club, dossard. Pas de
  date de naissance complète, pas de numéro de licence, pas d'e-mail.
- **Limitation de débit** sur toutes les routes non authentifiées, et sur
  l'échange PIN en particulier.
- **RGPD** : les compétiteurs sont majoritairement mineurs. Prévoir dès la v1
  l'export et la suppression des données d'une compétition, et une durée de
  conservation par défaut (proposition : archivage à 2 ans, purge à 5 ans).
  🟡 À arbitrer avec le club.

### 6.5 Accessibilité et ergonomie terrain

Contraintes de conception, pas de décoration :

- cibles tactiles ≥ 48 px, espacées de ≥ 8 px ;
- contraste ≥ 4.5:1, testé en plein soleil (pas seulement au validateur) ;
- thème clair par défaut, thème sombre disponible ;
- aucune action critique derrière un geste (glisser, appui long) ;
- police ≥ 16 px sur les champs de saisie (évite le zoom automatique iOS) ;
- retour haptique sur validation de saisie ;
- l'application fonctionne à 360 px de large et à 200 % de zoom.

---

## 7. API — esquisse

Base : `/api/v1`. JSON. Erreurs au format RFC 9457 (`application/problem+json`).

```
POST   /auth/login                       { email, password }
POST   /auth/refresh
POST   /auth/logout

GET    /competitions
POST   /competitions
GET    /competitions/:id
PATCH  /competitions/:id
POST   /competitions/:id/status          { status }

GET    /competitions/:id/categories
POST   /competitions/:id/categories
POST   /competitions/:id/competitors/import    (CSV, dry-run par défaut)
GET    /competitions/:id/competitors
POST   /competitions/:id/competitors
GET    /competitions/:id/routes
POST   /competitions/:id/routes
POST   /competitions/:id/routes/:rid/video     (upload ou lien)
GET    /competitions/:id/rounds
POST   /competitions/:id/rounds
GET    /competitions/:id/judges
POST   /competitions/:id/judges                → renvoie token + PIN UNE FOIS
POST   /competitions/:id/judges/:jid/revoke
GET    /competitions/:id/qrcodes.pdf

GET    /competitions/:id/dashboard             état temps réel pour l'orga
GET    /competitions/:id/conflicts
POST   /competitions/:id/conflicts/:cid/resolve
PATCH  /ascents/:id                            correction (motif obligatoire)

POST   /judge/auth                       { token, pin } → JWT juge
GET    /judge/bootstrap                  tout ce dont le juge a besoin, en un appel
POST   /judge/ascents/batch              [{ id, ... }] → état par élément

GET    /public/:slug                     métadonnées de la compétition
GET    /public/:slug/rankings?category=  classement publié
GET    /public/:slug/routes?category=
GET    /public/:slug/stream              SSE : ranking_updated, round_status_changed
```

`GET /judge/bootstrap` est délibérément un appel unique et gros : le juge le
déclenche une fois, au moment où il a encore du réseau, et travaille ensuite
dessus toute la journée.

---

## 8. Ce qui reste à trancher 🟡

Arbitré pendant le Lot 0 — détail et justification dans `DECISIONS.md` :

1. ~~Le modificateur `−` existe-t-il ?~~ Non — ADR-001.
2. ~~Ordre de passage et isolement en format phases ?~~ Hors périmètre v1,
   géré sur papier — ADR-006.
3. ~~Que fait foi quand deux juges notent le même passage différemment ?~~
   Les deux valeurs sont conservées, `conflict_group`, l'organisateur
   tranche (§ 6.3) — ADR-002 corrige l'incohérence de schéma qui l'empêchait.
4. ~~Le chronomètre de départage : à la main ou déclenché dans l'app ?~~ À la
   main uniquement en v1 — ADR-008.
5. ~~Fenêtre de correction autorisée au juge : durée exacte ?~~ Jusqu'à la
   saisie suivante ou 5 minutes, le premier des deux — ADR-007.
6. ~~Un compétiteur peut-il être inscrit dans deux catégories ?~~ Pas
   nécessaire : le surclassement est déjà supporté nativement, voir ADR-005.
7. ~~Voie modifiée (prises ajoutées) après des passages déjà saisis ?~~
   `hold_count` dénormalisé sur `ascent`, édition bloquée si des passages
   existent — ADR-003, ADR-004.
9. ~~Mode « secours total » si le serveur est injoignable une heure ?~~ Pas de
   mode dégradé à construire, on suppose un accès internet le jour J —
   ADR-009.
10. ~~Vidéos : téléversement direct ou lien externe en v1 ?~~ Déjà tranché par
    `ROADMAP.md` — lien externe au Lot 3, téléversement au Lot 9.

**Encore ouvert :**

8. Politique de conservation et de purge des données personnelles (RGPD) —
   à trancher avec le club avant le Lot 9.

---

## 9. Cas de test — la cotation doit les passer

Ces scénarios sont la définition de « correct ». Ils sont repris tels quels dans
la suite de tests de `packages/scoring`.

### Notation d'un passage

> Cas #3 (modificateur `−`) retiré — ADR-001. Cas #6 relibellé DNS — ADR-010.

| # | Situation | `score_value` attendue |
|---|---|---|
| 1 | Voie de 40 prises, prise 25 contrôlée | 25 |
| 2 | Idem, mouvement amorcé vers la 26 | 25.5 |
| 4 | Top | 41 |
| 5 | Absent, ne s'est jamais présenté (DNS) | 0 |
| 6 | Présenté puis retiré avant son ascension (DNS) | 0 |

### Classement sur une voie

| # | Situation | Attendu |
|---|---|---|
| 7 | A=30, B=30+, C=29 | B, A, C |
| 8 | A=30, B=30, chrono activé, A plus rapide | A, B |
| 9 | A=30, B=30, pas de chrono, pas de tour précédent | ex aequo 1ᵉʳ, suivant classé 3ᵉ |
| 10 | Trois tops | tous ex aequo 1ᵉʳˢ |

### Tour à deux voies (moyenne géométrique)

| # | Rangs (V1, V2) | Rang combiné | Ordre |
|---|---|---|---|
| 11 | A(1,4) B(2,2) | A=2.00, B=2.00 | ex aequo — départage par contre-performance, ou ex aequo véritable s'il s'agit du premier tour |
| 12 | A(1,9) B(3,3) | A=3.00, B=3.00 | ex aequo |
| 13 | A(1,1) B(2,2) C(3,3) | 1.00, 2.00, 3.00 | A, B, C |
| 14 | A(1,4) B(2,3) | A=2.00, B=2.45 | A puis B |

> Le cas 11 est le piège classique : une moyenne arithmétique donnerait 2.5 et 2
> et classerait B devant A. La moyenne géométrique les égalise. Si ton
> implémentation classe B devant A, elle est fausse.

### Format contest

| # | Situation | Attendu |
|---|---|---|
| 15 | M=3, A a grimpé 5 voies (30, 28, 25, 20, 10) | total = 83 |
| 16 | M=3, B n'a grimpé que 2 voies (40, 35) | total = 75 |
| 17 | A=83 et B=83, A a 2 tops et B 1 | A devant B |

### Phases et contre-performance

| # | Situation | Attendu |
|---|---|---|
| 18 | A 8ᵉ en demi, B 3ᵉ en demi, égalité en finale | B devant A |
| 19 | 10 qualifiés prévus, égalité aux places 10-11 | 11 qualifiés |
| 20 | A finaliste dernier, B demi-finaliste 1ᵉʳ non qualifié | A devant B au classement final |

### Hors ligne

| # | Situation | Attendu |
|---|---|---|
| 21 | Même passage envoyé deux fois (même `id`) | une seule ligne en base, pas d'erreur |
| 22 | Deux appareils, même (tour, voie, compétiteur), valeurs différentes | les deux conservés, `conflict_group` créé, organisateur alerté |
| 23 | Onglet fermé avec 12 passages en attente, rouvert plus tard | les 12 remontent |
| 24 | Passage saisi hors ligne à 14h03, remonté à 15h20 | `recorded_at` = 14h03, `synced_at` = 15h20 |

### Absence sur une voie (tour à plusieurs voies)

> Cas #25 ajouté au Lot 0 (ADR-016) : § 4.3 décrit ce comportement en prose,
> aucun cas d'origine ne le testait.

| # | Situation | Attendu |
|---|---|---|
| 25 | Tour à 2 voies, C et D absents (DNS) sur V2 uniquement, A et B présents sur les deux | C et D reçoivent le même rang sur V2 (le plus défavorable), partagé entre eux — pas deux rangs consécutifs distincts |
