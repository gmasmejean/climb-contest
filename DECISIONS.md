# DECISIONS.md — journal des décisions d'architecture (ADR)

Ce fichier consigne chaque décision prise en conversation, datée et numérotée.
Une entrée par décision : contexte, option retenue, options écartées,
justification. Ce qui n'est pas écrit ici est perdu à la session suivante.

---

## ADR-001 — Abandon du modificateur `n−`

**Date :** 2026-09-14
**Contexte :** SPEC.md §4.1 proposait trois modificateurs (`n−`, `n`, `n+`)
pour noter une prise, `n−` marquant "touchée mais non contrôlée". Le point
était flagué 🟡 dans SPEC.md §8.1.

**Décision :** seuls `n` (contrôlée) et `n+` (mouvement amorcé vers la
suivante) subsistent en v1.

**Options écartées :** garder les 3 états, plus fidèle à certains règlements
historiques.

**Justification :** distinguer "touché sans contrôle" de "contrôlé" est un
jugement fin et subjectif pour un bénévole non formé — exactement le profil
d'utilisateur que CLAUDE.md cible. Moins d'ambiguïté de jugement sous pression
= moins d'erreurs et de contestations.

**Conséquences :**

- `score_value` perd la branche `hold_number − 0.5`.
- Le cas de test SPEC.md §9 #3 ("prise 25 touchée non contrôlée → 24.5") est
  retiré (plus aucune situation ne le produit).
- `RULES.md` (Lot 2) doit documenter explicitement cette simplification et sa
  justification pour le juge fédéral qui le relira.

---

## ADR-002 — Correction de l'index unique sur `ascent`

**Date :** 2026-09-14
**Contexte :** SPEC.md §5 définissait
`UNIQUE (round_id, route_id, competitor_id) WHERE superseded_by IS NULL`.
Cette contrainte est incompatible avec la politique de conflit de §6.3 et le
cas de test #22, qui exigent que deux passages contradictoires soient tous
les deux conservés avec `superseded_by IS NULL` — le second `INSERT`
échouerait en base avant même la création d'un `conflict_group`.

**Décision :**

```sql
UNIQUE (round_id, route_id, competitor_id)
  WHERE superseded_by IS NULL AND conflict_group IS NULL
```

Une ligne en conflit sort temporairement de la contrainte d'unicité ; elle y
revient quand l'organisateur tranche (la ligne perdante reçoit
`superseded_by`).

**Options écartées :** aucune — c'est un correctif de bug, pas un choix de
conception.

---

## ADR-003 — `hold_count` dénormalisé sur `ascent`, `score_value` non "GENERATED" au sens strict

**Date :** 2026-09-14
**Contexte :** SPEC.md §5 décrivait `score_value` comme colonne `GENERATED`
calculée à partir de `hold_count + 1` si TOP. Postgres n'autorise une colonne
générée qu'à référencer des colonnes de la **même ligne** ; `hold_count` vit
sur `route`, pas sur `ascent`. Tel quel, irréalisable.

**Décision :** ajouter `ascent.hold_count (int, not null)`, une copie de
`route.hold_count` capturée au moment de la saisie. `score_value` redevient
alors une vraie colonne `GENERATED ALWAYS AS (...) STORED`, calculée
uniquement à partir des colonnes de `ascent` (`hold_number`, `modifier`,
`is_top`, `status`, `hold_count`).

**Options écartées :** calculer `score_value` en application (trigger ou
code serveur) sans dénormaliser. Écarté : ça résout le problème technique
mais pas le problème métier ci-dessous (ADR-004), et perd la garantie
"jamais désynchronisé" d'une colonne générée.

**Conséquences :** cette dénormalisation résout aussi ADR-004.

---

## ADR-004 — Voie modifiée ou retirée après des passages déjà saisis

**Date :** 2026-09-14
**Contexte :** SPEC.md §8.7 : que se passe-t-il si une voie est modifiée
(prises ajoutées) après des passages saisis ? Le prompt initial de
l'utilisateur ajoute le cas symétrique : une voie retirée après des passages.

**Décision :**

- **`hold_count`** : grâce à ADR-003, chaque `ascent` garde le `hold_count`
  valable au moment de sa saisie — un TOP à 14h et un TOP à 16h restent
  comparables même si la voie a changé entre-temps. Mais l'édition de
  `route.hold_count` est **bloquée dès qu'un passage existe sur la voie** :
  l'organisateur doit d'abord annuler les passages concernés (tracé dans
  `ascent_event`) avant de corriger la voie.
- **Retrait d'une voie** : suppression logique uniquement (`deleted_at`,
  jamais de `DELETE`). Le retrait est bloqué dès que le tour est ouvert et
  qu'un passage existe sur la voie, sauf confirmation explicite tracée par
  l'organisateur.

**Justification :** équité — les grimpeurs qui sont passés avant et après un
changement de voie ne doivent pas être comparés sur des bases différentes
sans que ce soit explicite et assumé par l'organisateur.

---

## ADR-005 — Compétiteur : changement de catégorie et surclassement

**Date :** 2026-09-14
**Contexte :** SPEC.md §8.6 demandait si un compétiteur peut être inscrit
dans deux catégories (surclassement). Le prompt initial ajoute : que se
passe-t-il si un compétiteur change de catégorie en cours de compétition ?

**Décision :**

- **Surclassement** : déjà supporté nativement, sans changement de modèle.
  `competitor.category_id` est la catégorie **d'inscription**, choisie par
  l'organisateur, pas une catégorie dérivée de `birth_year`. Les bornes
  `birth_year_min`/`birth_year_max` sur `category` restent purement
  informatives : ne jamais les valider comme contrainte bloquante contre
  `competitor.birth_year`, au plus un avertissement non bloquant dans l'UI
  organisateur.
- **Changement de catégorie en cours de compétition** : **bloqué dès qu'un
  `ascent` existe** pour ce compétiteur dans la compétition. Raison : la
  catégorie d'un passage n'est pas stockée sur `ascent` (elle est résolue via
  `competitor.category_id` au moment du calcul de classement) — un
  changement tardif reclasserait rétroactivement et silencieusement des
  résultats déjà produits.

**Options écartées :** modéliser une double catégorie (inscription multi-
catégories) — écarté, hors périmètre v1, inutile puisque le surclassement ne
le requiert pas.

---

## ADR-006 — Ordre de passage et isolement en finale : hors périmètre v1

**Date :** 2026-09-14
**Contexte :** SPEC.md ne mentionne l'ordre de passage ni l'isolement des
grimpeurs en demi-finale/finale nulle part dans le périmètre v1, alors qu'une
vraie finale FFME les impose.

**Décision :** non modélisé en v1. Géré sur papier par l'organisateur, hors
application.

**Options écartées :** un champ `climbing_order` + statut d'isolement par
(tour, catégorie, compétiteur), visible côté juge — écarté pour cette
version : élargit le Lot 3 (données) et le Lot 5 (UI juge) au-delà du
périmètre annoncé par ROADMAP.md.

**Suivi :** noté dans `TODO.md` comme extension possible post-v1.

---

## ADR-007 — Fenêtre de correction du juge

**Date :** 2026-09-14
**Contexte :** SPEC.md §3.2 et §8.5 flaguaient 🟡 la durée exacte de la
fenêtre pendant laquelle un juge peut corriger sa dernière saisie sans passer
par l'organisateur.

**Décision :** la correction reste accessible **jusqu'à la saisie suivante du
juge (n'importe quel compétiteur) OU 5 minutes après la saisie initiale, le
premier des deux qui survient**. Passé ce délai, seule l'organisateur peut
corriger (Lot 8), avec motif obligatoire et traçage.

**Options écartées :**

- 5 minutes fixes, sans condition sur la saisie suivante — plus simple mais
  arbitraire : un juge qui enchaîne vite peut voir la fenêtre se refermer
  avant de remarquer son erreur.
- Jusqu'à confirmation par l'organisateur — trop permissif et flou : un
  passage "provisoirement modifiable" pendant potentiellement des heures
  complique l'affichage public (que montrer entre-temps ?).

---

## ADR-008 — Chronomètre de départage : saisie manuelle uniquement

**Date :** 2026-09-14
**Contexte :** SPEC.md §8.4 flaguait 🟡 si le chronomètre de départage
(`climb_time_ms`) est saisi à la main ou déclenché dans l'app.

**Décision :** saisie manuelle uniquement en v1 (champ nullable, visible
seulement si `competition.timing_enabled`). Pas de déclenchement/chrono dans
l'app.

**Justification :** un juge qui doit à la fois chronométrer au tap près et
noter la hauteur atteinte perd en fiabilité sur les deux tâches — et le
chronométrage de départage est de toute façon rarement utilisé en club
(champ optionnel dès la conception SPEC.md).

---

## ADR-009 — Hébergement et connectivité : pas de mode "zéro internet"

**Date :** 2026-09-14
**Contexte :** SPEC.md §8.9 demandait comment l'organisateur reprend la main
si le serveur est injoignable une heure. La question initiale posée à
l'utilisateur ("laptop sur place vs VPS distant") était mal calibrée : le
déploiement Docker Compose rend l'artefact identique quel que soit
l'hébergement — ce n'est pas un choix d'architecture. La vraie question
technique sous-jacente est : faut-il supporter le cas où la salle n'a aucun
accès internet (ce qui changerait la stratégie TLS, Caddy + ACME nécessitant
un accès sortant pour délivrer un certificat) ?

**Décision :** non, pas besoin de supporter le cas "zéro internet". On
suppose toujours au moins une connexion internet disponible le jour J (même
médiocre). Caddy + ACME standard ; pas de mode TLS dégradé (auto-signé / CA
interne) à construire. L'hébergement (VPS ou machine sur place) reste un
choix opérationnel libre, sans conséquence sur le code.

**Note :** les juges restent indépendants de ce choix dans tous les cas — le
hors ligne est conçu dès le départ pour ne dépendre d'aucune connectivité
réseau, locale ou internet, au moment de la saisie.

---

## ADR-010 — Vocabulaire DNS / DNF

**Date :** 2026-09-14
**Contexte :** le cas de test SPEC.md §9 #6 étiquette "Abandon avant départ"
comme `DNF`, ce qui contredit la définition usuelle (DNF = abandon pendant/
après le départ ; DNS = absent, jamais présenté).

**Décision :** clarifier la définition dans SPEC.md et `RULES.md`, sur le
modèle athlétisme (DNS = _did not start_, DNF = _did not finish_) :
`DNS` = le compétiteur n'a pas démarré son ascension — qu'il ne se soit
jamais présenté, ou qu'il se soit présenté puis retiré avant de commencer à
grimper ; `DNF` = le compétiteur a commencé à grimper et son ascension a été
interrompue anormalement avant une conclusion normale (ex. blessure en cours
d'ascension) — à ne pas confondre avec une chute normale, qui reste notée à
la hauteur atteinte (`chute`), pas en DNF. Le cas de test #6 ("abandon avant
départ") est corrigé pour utiliser `DNS`, puisque l'abandon a lieu **avant**
le début de l'ascension.

**Conséquence sur le calcul :** aucune — les deux restent `score_value = 0`.
C'est une clarification de vocabulaire pour l'audit et pour la lisibilité de
`RULES.md`, pas un changement de règle de cotation.

---

## ADR-011 — Mode de cotation "points par prise" différé hors v1

**Date :** 2026-09-14
**Contexte :** SPEC.md §4.5 proposait un second mode de calcul pour le format
contest ("points par prise"), flagué 🟡 optionnel.

**Décision :** différé hors v1. Seul le mode "somme des M meilleures"
(défaut) est implémenté. L'interface `ScoringEngine` (SPEC.md §4.6) permet de
l'ajouter plus tard sans migration.

**Justification :** réduit la surface de test du Lot 2, qui est déjà le lot
le plus critique du projet.

---

## ADR-012 — Portée de TanStack Query : organisateur et public seulement

**Date :** 2026-09-14
**Contexte :** SPEC.md §6.1 propose TanStack Query pour l'état serveur, sans
préciser son rôle vis-à-vis du hors-ligne juge.

**Décision :** TanStack Query gère le cache/les mutations pour les écrans
organisateur et public. L'interface juge **ne passe pas** par TanStack
Query : IndexedDB (Dexie) est l'unique source de vérité, avec un moteur de
synchronisation dédié (`packages/sync`, cf. ADR-014) gérant la file
d'attente, l'état optimiste et les retries.

**Justification :** le "network-first avec repli cache" de TanStack Query ne
donne pas les garanties de durabilité exigées par CLAUDE.md (survie à la
fermeture d'onglet, au redémarrage du téléphone, idempotence par lot) — ces
garanties demandent une machine à états explicite, pas une bibliothèque de
cache réseau généraliste.

---

## ADR-013 — Classement public calculé en SQL explicite

**Date :** 2026-09-14
**Contexte :** CLAUDE.md exige "pas d'ORM magique sur le chemin critique.
Les requêtes de classement sont écrites et lisibles." SPEC.md propose Drizzle
ORM sans préciser cette frontière.

**Décision :** Drizzle reste utilisé pour le schéma, les migrations et le
CRUD organisateur. La requête qui alimente `GET /public/:slug/rankings`
(chemin chaud, cible 300 spectateurs simultanés, Lot 7) est écrite en SQL
explicite (via `sql\`\`` de Drizzle, paramétré et typé), pas via l'API
relationnelle de Drizzle qui peut générer du N+1 invisible. Le résultat est
caché côté serveur et invalidé à chaque passage.

---

## ADR-014 — Diffusion temps réel via `LISTEN/NOTIFY` Postgres, et ajout de `packages/sync`

**Date :** 2026-09-14
**Contexte :** SPEC.md §6.1 choisit SSE pour le temps réel (décision non
contestée). Reste à préciser comment une écriture en base déclenche la
diffusion SSE.

**Décision :**

- Le pont "écriture `ascent`/`round` → diffusion SSE" passe par
  `LISTEN/NOTIFY` Postgres, pas par un `EventEmitter` Node en mémoire.
- Ajout de `packages/sync` à l'arborescence (SPEC.md §6.2) : machine à états
  pure de la file de synchronisation côté client (`pending` → `sent` →
  `acked`/`conflict`, backoff exponentiel + jitter, batching), testable sans
  Vue ni IndexedDB réel — même traitement que CLAUDE.md impose à
  `packages/scoring`.

**Justification :** un `EventEmitter` en mémoire casse dès que Node tourne
en plusieurs workers/processus ; `LISTEN/NOTIFY` évite d'introduire une
dépendance Redis tout en restant correct en multi-process, sans violer "pas
de verrouillage fournisseur". `packages/sync` isolé et testé reflète que le
Lot 6 (hors ligne) est annoncé comme le plus difficile du projet — il mérite
la même rigueur que la cotation.

---

## ADR-015 — Génération QR codes et PDF sans dépendance externe

**Date :** 2026-09-14
**Contexte :** ROADMAP.md Lot 4 et Lot 9 exigent une génération de QR codes
et de PDF "côté serveur, pas de dépendance à un service externe", sans que
SPEC.md ne précise d'outillage.

**Décision :** `qrcode` (génération JS pure, aucun appel réseau) pour les QR
codes ; `pdf-lib` pour la mise en page PDF (planche de QR codes, exports de
résultats).

**Options écartées :** un rendu PDF via navigateur headless (type
Puppeteer) — écarté, dépendance Chromium disproportionnée pour ce besoin et
mauvais candidat pour une image Docker légère.

---

## ADR-016 — Cas de test manquant : absence sur une voie d'un tour à plusieurs voies

**Date :** 2026-09-14
**Contexte :** SPEC.md §4.3 décrit en prose qu'un compétiteur absent sur une
voie reçoit "le rang le plus défavorable de cette voie (dernier ex aequo)",
mais aucun des 24 cas de test de §9 ne couvre ce cas pour le calcul par
moyenne géométrique.

**Décision :** ajouter un cas de test #25 à SPEC.md §9 : dans un tour à deux
voies, tous les compétiteurs absents sur une même voie reçoivent le même
rang sur cette voie (le plus défavorable), partagé entre eux — pas des rangs
consécutifs distincts.

---

## ADR-017 — Inscription organisateur ouverte, invitation pour les comptes suivants

**Date :** 2026-09-15
**Contexte :** `ROADMAP.md` Lot 1 demandait explicitement une recommandation
sur la politique d'inscription (« réservée au premier utilisateur ou par
invitation »). La réponse a clarifié le vrai besoin : n'importe qui doit
pouvoir créer un compte organisateur (et donc un nouveau club) en visitant
l'application — ce n'est pas un bootstrap mono-club. Les comptes
supplémentaires d'un même club, eux, sont créés par invitation d'un `owner`.

**Décision :**

- `POST /auth/register` reste ouverte en permanence : elle crée un nouveau
  `club` (nom fourni au formulaire) et son premier `user` (`role = 'owner'`),
  avec `email_verified_at = null` jusqu'à validation du lien reçu par e-mail.
- La connexion est refusée tant que `email_verified_at` est `null`.
- `POST /auth/invitations` (réservée aux `owner`, cf. middleware
  `requireOwner`) crée un `user` du même club, `password_hash = null`, avec
  un jeton d'invitation envoyé par e-mail. `POST
/auth/invitations/accept` définit le mot de passe et active le compte
  (cliquer un lien reçu sur sa propre boîte prouve déjà la possession de
  l'e-mail — pas de double vérification pour ce chemin).
- Extension de la table `user` (au-delà de `SPEC.md` § 5) : `password_hash`
  devient nullable, ajout de `email_verified_at`, `invited_by_user_id`,
  `pending_token_hash`, `pending_token_purpose`
  (`'email_verification' | 'invitation'`), `pending_token_expires_at`. Un
  seul mécanisme de « jeton en attente » couvre les deux usages plutôt qu'une
  table séparée par cas.
- Seul le rôle `owner` peut inviter (`organizer` ne le peut pas) — choix par
  défaut le plus simple, non demandé explicitement, à revoir si un besoin de
  délégation plus fin apparaît.

**Options écartées :**

- Bootstrap « premier utilisateur seulement » avec un club unique par
  déploiement — écarté : ne correspond pas au besoin réel (n'importe quel
  club doit pouvoir s'inscrire lui-même).
- Une table `invitation` séparée — écartée au profit de l'extension de
  `user`, plus proche du modèle existant et sans duplication de type.

**Conséquences :** validation admin des créations de club/organisateur et
zone publique de recherche club/compétition, mentionnées comme besoins
futurs, notées dans `TODO.md` — hors périmètre de ce lot.

---

## ADR-018 — Migrations réversibles sans rollback natif de Drizzle Kit

**Date :** 2026-09-15
**Contexte :** CLAUDE.md et `ROADMAP.md` Lot 1 exigent des migrations
réversibles, testées dans les deux sens. Drizzle Kit (`drizzle-kit
generate`) ne génère que des migrations « up » ; il n'a pas d'équivalent
« down » intégré.

**Décision :** chaque migration générée (`packages/db/drizzle/NNNN_*.sql`)
est accompagnée d'un fichier `NNNN_*.down.sql` écrit à la main, qui annule
exactement ce que le fichier « up » a créé. Un petit runner maison
(`packages/db/src/migrate-shared.ts`, exposé via `migrate.ts` et
`migrate-down.ts`) applique les fichiers dans l'ordre, suit l'état dans une
table `_migrations_applied` (distincte de la table interne de Drizzle,
puisqu'on ne passe pas par son `migrate()`), et permet de reculer d'un ou
plusieurs crans. Testé par `packages/db/src/db.test.ts` (up → down → up,
vérifie que le jeu de tables revient exactement à zéro puis se recrée).

**Options écartées :**

- Un outil de migration tiers avec support natif du rollback (ex.
  `node-pg-migrate`) — écarté pour ne pas abandonner Drizzle Kit comme
  source de vérité du schéma (diff automatique depuis `schema.ts`).
- Convention `text` + `CHECK` plutôt que des `ENUM` Postgres natifs pour
  toutes les colonnes à choix fermé (rôle, statuts…) : un `ENUM` ne peut pas
  perdre de valeur sans recréer le type, ce qui aurait compliqué chaque
  migration « down » touchant ces colonnes.

---

## ADR-019 — Interface `Mailer`, SMTP configurable, Mailpit en dev/test/CI

**Date :** 2026-09-15
**Contexte :** ADR-017 introduit un besoin d'envoi d'e-mail réel (validation,
invitation) qu'aucun document de référence ne prévoyait.

**Décision :** interface `Mailer` (`send(to, subject, html): Promise<void>`),
dans le même esprit que `StorageAdapter` (SPEC.md § 6.1). Implémentation
`SmtpMailer` (`nodemailer`), configurée uniquement par variables
d'environnement (`SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`) — aucun verrou
fournisseur. En dev/test/CI, `SMTP_HOST` pointe vers un conteneur Mailpit
(`docker-compose.yml`) : aucun e-mail n'est jamais réellement envoyé hors
production. Les tests d'intégration (`apps/api`) utilisent une
`FakeMailer` en mémoire plutôt que Mailpit, pour rester rapides et
déterministes sans dépendre d'un conteneur SMTP supplémentaire en CI.

**Options écartées :** un service transactionnel tiers (SendGrid, Postmark…)
— écarté, contraire à « pas de verrouillage fournisseur » (CLAUDE.md/
SPEC.md § 6.1).

---

## ADR-020 — Vérification d'e-mail déclenchée par le front en `POST`, jamais par un `GET` serveur

**Date :** 2026-09-15
**Contexte :** la première implémentation du Lot 1 faisait pointer le lien
de l'e-mail directement vers `GET /api/v1/auth/verify-email?token=…`, qui
validait le jeton et redirigeait (302) vers `/login`. En testant, le lien
ne fonctionnait pas de façon fiable — creusé en session : un `GET` qui a un
effet de bord (ici, marquer l'e-mail comme vérifié) est visité par des
acteurs qui ne sont pas l'utilisateur avant même qu'il clique — navigateurs
qui précharge des liens, extensions de productivité/sécurité, passerelles
anti-hameçonnage qui « pré-visitent » les liens des e-mails pour les
scanner. N'importe lequel de ces acteurs consomme alors le jeton à la place
de l'utilisateur, qui se retrouve avec un lien « déjà utilisé » sans avoir
rien fait.

**Décision :** le lien de l'e-mail pointe désormais vers `/login?token=…`
— une page du front, un `GET` sans aucun effet de bord (un scanner qui la
visite ne déclenche rien). C'est le JavaScript de cette page
(`apps/web/src/pages/Login.vue`, au montage) qui appelle `POST
/api/v1/auth/verify-email` avec le jeton, puis retire `token` de l'URL
(`router.replace`) pour qu'un rechargement ne retente pas l'appel.
`GET /api/v1/auth/verify-email` n'existe plus.

**Règle générale à retenir pour la suite du projet :** un `GET` ne doit
jamais avoir d'effet de bord (idempotence HTTP). Toute action qui modifie
l'état — même déclenchée par un clic sur un lien d'e-mail — passe par un
appel explicite du client (`POST`/`PATCH`/`DELETE`), jamais par le simple
chargement d'une page.

**Options écartées :** garder le `GET` côté serveur en le rendant
idempotent (« déjà vérifié » traité comme un succès plutôt qu'une erreur)
— atténue le symptôme pour un jeton déjà consommé, mais ne protège pas le
tout premier clic si c'est un scanner qui l'effectue en premier ; écarté au
profit de la correction structurelle ci-dessus.

---

## ADR-021 — Moteur de cotation (Lot 2) : deux écarts avec l'interface `ScoringEngine` littérale de SPEC.md §4.6

**Date :** 2026-09-15
**Contexte :** en implémentant `packages/scoring`, deux endroits où
`SPEC.md` §4.6 (l'interface `ScoringEngine`, donnée telle quelle) contredit
le reste de la spec, discutés et tranchés avec l'utilisateur avant d'écrire
le code.

**Décision 1 — `configSchema` n'est pas un vrai `ZodSchema`.** §6.2 dit
explicitement que `packages/scoring` ne dépend « ni de la base, ni de Zod,
ni du réseau », alors que §4.6 type littéralement
`configSchema: ZodSchema`. Le paquet reste à **zéro dépendance de
production** : `configSchema` est typé structurellement
(`ConfigSchema<T> = { parse(input: unknown): T }`), un sous-ensemble de
l'API Zod qu'un vrai schéma Zod satisfait sans que ce paquet importe `zod`.
Le validateur du moteur `ffme-difficulty-2026` (`config.ts`) est écrit à la
main, sans aucune librairie.
**Options écartées :** ajouter `zod` comme dépendance réelle de
`packages/scoring` — rejeté, contredit littéralement §6.2, qui nomme `Zod`
explicitement (pas un oubli).

**Décision 2 — le départage par contre-performance (« countback ») n'est
appliqué qu'une seule fois, dans `rankRound`, jamais dans `rankRoute`.**
§4.2 liste le countback comme 2ᵉ critère de départage pour le classement
_d'une voie_, mais §4.6 type `rankRoute(ascents, route)` sans aucun moyen de
recevoir le classement du tour précédent dont ce départage a besoin. Aucun
des 25 cas de test de §9 n'exerce ce départage au niveau d'une seule voie
(seulement au niveau du tour, cas 11/12/18).
`rankRoute` garde sa signature à 2 paramètres, telle quelle, et ne résout
que ce qui lui est intrinsèque (chrono, ex aequo vrai). Le countback est
appliqué une seule fois dans `rankRound(routeRankings, ctx)` — qui a déjà
`ctx` dans sa signature —, aussi bien pour un tour à une seule voie (où le
« classement combiné » est simplement celui de l'unique voie, y compris ses
ex aequo non résolus par `rankRoute`) que pour un tour à plusieurs voies.
Aucune extension d'interface n'a donc été nécessaire.
**Un seul niveau de recul (`ctx.previousRoundRanking`) suffit** pour
satisfaire la récursion demandée par §4.4 (« puis sur le tour d'avant, et
ainsi de suite ») : chaque `RoundRanking` est déjà calculé avec son propre
`previousRoundRanking`, donc tout écart résolvable au tour N-1 (via le tour
N-2, etc.) s'est déjà propagé au moment où le tour N l'utilise. `rankFinal`
n'a donc plus besoin de départager quoi que ce soit — il assemble les tours
en paliers (le tour atteint prime toujours sur la performance brute, cas
20), sans re-comparer les performances entre elles.

**Décisions techniques dérivées (non discutées explicitement, déduites
directement de la spec) :**

- **Comparaison de la moyenne géométrique par produit d'entiers, pas par
  racine.** `rang_combiné = (r₁×…×r_k)^(1/k)` est strictement croissante en
  fonction du produit `r₁×…×r_k` (k fixé) : comparer les produits (entiers,
  exacts) donne un ordre rigoureusement identique à comparer les racines,
  sans jamais passer par `Math.pow`/`sqrt` pour trier. `Math.pow` n'est
  utilisé que pour la valeur _affichée_ (`combinedRank`, arrondie à 2
  décimales), jamais pour le tri. Répond à la mise en garde de
  `ROADMAP.md` (`√(1×4)` doit être strictement égal à `√(2×2)`).
- **Le départage par chrono est détecté par la présence de la donnée**,
  pas par un flag `competition.timing_enabled` séparé (`rankRoute` n'y a
  pas accès) : il s'applique quand **tout un groupe à égalité** a un
  `climb_time_ms` connu ; sinon le groupe reste ex aequo.
- **Format contest, départage « voies tentées » (non testé par §9)** :
  interprété comme le nombre de voies avec `score_value > 0` sur
  l'ensemble des voies du compétiteur (pas seulement les M retenues) — pas
  le nombre de voies avec `status ≠ 'dns'`, qui aurait nécessité de faire
  transiter le statut jusqu'à `RouteRankEntry` pour distinguer DNF/DSQ de
  DNS. « Nombre de tops » compté parmi les M voies retenues dans le total.
  Signalé explicitement comme hypothèse à valider dans `RULES.md` §6.
- **`rankRound` valide que chaque compétiteur apparaît dans le classement
  de **toutes** les voies du tour** (format phases) avant de calculer la
  moyenne géométrique — lève une erreur explicite sinon, plutôt que de
  produire silencieusement un classement faux à partir d'ensembles de
  compétiteurs incohérents entre voies. **Limite assumée** : cette
  validation ne détecte qu'une incohérence _entre_ les voies passées en
  paramètre. Elle ne peut pas détecter un compétiteur totalement absent de
  toutes les voies du tour (jamais même un DNS) — rien dans l'interface
  `ScoringEngine` (§4.6) ne donne à cette fonction la liste complète des
  compétiteurs attendus pour comparer. **Précondition côté appelant** :
  avant d'appeler `rankRound`, le code qui construit les `RouteRanking` à
  partir de la base doit garantir qu'un `ascent` (au moins DNS) existe pour
  chaque compétiteur inscrit dans la catégorie, sur chaque voie du tour —
  sinon ce compétiteur est silencieusement absent du classement. À vérifier
  explicitement au Lot 3/8 quand ce code sera écrit.

**Relecture post-implémentation (2026-09-15, `/code-review high`)** : trois
correctifs de fond apportés après une relecture dédiée du lot, tous
vérifiés par test avant/après :

- **Bug de correction** : `breakTiesByCountback` traitait un compétiteur
  absent du classement du tour précédent comme "infiniment mauvais"
  (`Number.POSITIVE_INFINITY`), ce qui le séparait silencieusement des
  autres membres du groupe au lieu de les laisser ex aequo — contredisant
  le commentaire de la fonction elle-même. Corrigé : le countback n'est
  appliqué à un groupe que si **tous** ses membres ont un rang au tour
  précédent ; sinon le groupe entier reste ex aequo vrai.
- **Bug de déterminisme** : en format contest, quand plusieurs voies d'un
  même compétiteur sont à égalité de `score_value` exactement à la limite
  des M voies retenues, laquelle des voies à égalité est effectivement
  comptée dépendait de l'ordre du tableau `routeRankings` fourni par
  l'appelant (tri stable de `Array.prototype.sort`) — deux appels avec les
  mêmes données mais un ordre de voies différent pouvaient produire un
  nombre de tops différent, et donc un classement différent. Corrigé : à
  égalité de `score_value`, la voie effectivement topée (`isTop`) est
  systématiquement préférée dans la sélection des M meilleures, ce qui
  rend le résultat indépendant de l'ordre d'entrée.
- **Performance** : `rankRoundPhases` cherchait le rang de chaque
  compétiteur par balayage linéaire (`Array.find`) dans chaque
  `RouteRanking`, soit un coût quadratique en nombre de compétiteurs par
  voie. Remplacé par une `Map<competitorId, rank>` construite une seule
  fois par voie. `breakTiesByCountback` reconstruisait aussi sa `Map` du
  tour précédent à chaque groupe ex aequo au lieu d'une fois par appel de
  `rankRound` — corrigé de la même façon.
- **CI** : les seuils de couverture à 100 % de `packages/scoring/vitest.config.ts`
  n'étaient vérifiés par aucune étape de `.github/workflows/ci.yml` (`pnpm test`
  n'y passait pas `--coverage`). Corrigé en ajoutant `--coverage` directement
  au script `test` de `packages/scoring/package.json`, plutôt que de modifier
  la CI ou les autres paquets — c'est le seul paquet du projet où cette
  exigence s'applique (voir `ROADMAP.md`).
- **Style** : les commentaires techniques du paquet étaient rédigés en
  français, en contradiction avec `CLAUDE.md` (« commentaires techniques :
  anglais »). Traduits. Les messages d'erreur (destinés à remonter
  jusqu'à un humain) et les chaînes `it(...)`/`describe(...)` des tests
  (qui reprennent le vocabulaire français de `SPEC.md` §9) restent en
  français, cohérent avec le reste du dépôt (voir `packages/contracts`).

---

## ADR-022 — Dossards : `competitor.bib` nullable, attribution automatique séquentielle par catégorie

**Date :** 2026-09-16
**Contexte :** le Lot 1 avait défini `competitor.bib` en `NOT NULL`
(`packages/db/src/schema.ts`). C'est incompatible avec ROADMAP.md Lot 3 :
« attribution des dossards, manuelle ou automatique » suppose qu'un
compétiteur puisse exister sans dossard, et le contrôle « prêt à
démarrer ? » doit pouvoir détecter un « compétiteur sans dossard » — un cas
impossible si la colonne est obligatoire.

**Décision :**

- **`competitor.bib` devient nullable.** Migration
  `0001_competitor_bib_nullable` (up : `DROP NOT NULL`, down : `SET NOT
NULL`), testée dans les deux sens (`packages/db/src/db.test.ts`).
  L'index unique `(competition_id, bib)` reste inchangé : Postgres ne
  considère jamais deux `NULL` comme égaux, donc plusieurs compétiteurs
  sans dossard coexistent sans violation de contrainte.
- **Attribution automatique** (`POST
/competitions/:id/competitors/assign-bibs`) : numérotation séquentielle
  continue sur toute la compétition, en parcourant les catégories dans
  leur `display_order` puis les compétiteurs par nom/prénom (locale
  `fr`). Ne touche que les compétiteurs sans dossard ; les numéros déjà
  attribués manuellement sont respectés et jamais réutilisés (recherche du
  plus petit entier libre à chaque affectation).

**Options écartées :** plages de dossards réservées par catégorie (ex.
100-199 pour U12) — écarté, discuté avec l'utilisateur, préférence pour
une numérotation continue plus simple à vérifier d'un coup d'œil sur la
liste des compétiteurs.

---

## ADR-023 — Round implicite du format contest, synchronisé sur `route_category`

**Date :** 2026-09-16
**Contexte :** SPEC.md §5 « Points d'attention » précise qu'une compétition
au format contest crée un `round` unique implicite (`type =
'qualification'`, `display_order = 0`), pour éviter un `round_id`
nullable sur `ascent`. Le Lot 3 doit décider qui peuple `round_route` pour
ce round, puisque le format contest n'expose pas d'écran « Tours » à
l'organisateur.

**Décision :** le round implicite est créé par l'API à la création de la
compétition (`style = 'onsight'` par défaut — un contest n'a pas la
notion d'isolement flash/à vue de la spec, ce style est un choix neutre
sans effet observable en v1). Chaque création ou suppression d'une
association `route_category` (onglet Voies) fait apparaître ou disparaître
automatiquement la ligne `round_route` correspondante pour ce round
(`apps/api/src/lib/contest-round.ts`) — jamais géré manuellement par
l'organisateur. En format phases, `round` et `round_route` restent
entièrement pilotés par l'écran « Tours ».

**Conséquence :** le moteur de cotation (Lot 5+) retrouve donc toujours
ses voies via `round_route`, qu'il s'agisse d'un contest ou de phases,
sans branche de code spécifique au format à ce niveau.

**Friction notée avec le Lot 2 :** `ffme-difficulty-2026ConfigSchema`
(ADR-021) exige `routesCounted` quel que soit le format, alors que ce
nombre n'a de sens que pour un contest (§4.5). Le formulaire de création
ne le demande pas en format phases ; l'API fournit alors une valeur
neutre (`{routesCounted: 1}`, jamais utilisée en pratique par
`rankRound`/`rankFinal` en mode phases) plutôt que d'imposer ce champ à
l'organisateur. Pas de modification de `packages/scoring` pour ce lot —
si cette friction devient gênante, `TODO.md` note qu'il faudrait rendre
`routesCounted` optionnel/ignoré pour un moteur utilisé en phases.

---

## ADR-024 — Format de l'import CSV des compétiteurs

**Date :** 2026-09-16
**Contexte :** SPEC.md ne fixe pas de format de colonnes pour l'import CSV
en masse (ROADMAP.md Lot 3). Discuté et tranché avec l'utilisateur.

**Décision :**

- **Colonnes** (en-tête, insensible à la casse et aux accents) :
  `dossard` (optionnel), `prenom`, `nom`, `categorie` (doit correspondre
  au libellé exact d'une catégorie existante de la compétition, comparaison
  insensible à la casse), `annee_naissance` (optionnel), `club`
  (optionnel), `licence` (optionnel).
- **Doublon** = même dossard, ou même prénom+nom, que ce soit entre deux
  lignes du fichier ou avec un compétiteur déjà en base pour cette
  compétition.
- **Tout ou rien** : `POST .../competitors/import` prend un `mode`
  (`preview` | `commit`). Le serveur ré-analyse et revalide intégralement
  le CSV dans les deux modes — jamais confiance en un aperçu déjà validé
  côté client. En `commit`, si la moindre ligne est en erreur, rien n'est
  écrit (422, rapport détaillé renvoyé) ; l'organisateur corrige son
  fichier et relance un aperçu. L'écriture effective se fait dans une
  transaction (première utilisation de `db.transaction()` dans
  `apps/api`).
- **Écart au format RFC 9457** : la réponse de `.../import` (succès comme
  échec 422) est le rapport structuré ligne par ligne
  (`ImportReport`/`ImportRow`, `packages/contracts`), pas un corps
  `problem+json` — un couple title/detail ne peut pas porter une erreur
  par ligne. Écart assumé et isolé à cette seule route
  (`apps/api/src/routes/competitors.ts`).

**Options écartées :** import partiel (écrire les lignes valides, ignorer
les autres) — écarté par l'utilisateur, qui préfère un fichier propre
avant toute écriture plutôt que devoir recouper après coup qui a été
importé ou non.

---

## ADR-025 — Calcul des tranches d'âge du modèle de catégories FFME

**Date :** 2026-09-16
**Contexte :** SPEC.md §1 et ROADMAP.md Lot 3 demandent un modèle de
catégories FFME prédéfini (U12 à Vétéran × Homme/Femme) avec des bornes
`birth_year_min`/`birth_year_max`. Le règlement exact n'était pas dans
`SPEC.md` ; l'utilisateur en a cité le texte intégralement le 2026-09-16.

**Décision :** calcul automatique, appliqué par `POST
/competitions/:id/categories/template`
(`apps/api/src/lib/ffme-categories.ts`), d'après ce texte réglementaire :

> U8 : 6-7 ans, U10 : 8-9, **U12 : 10-11 (poussin)**, **U14 : 12-13
> (benjamin)**, **U16 : 14-15 (minime)**, **U18 : 16-17 (cadet)**, **U20 :
> 18-19 (junior)**, **Sénior : 20 à 39 ans**, Vétéran 1 : 40-49, Vétéran 2 :
> 50 et plus. « Le changement de catégorie pour une saison sportive est
> déterminé en prenant en référence l'année de naissance et l'année civile
> débutant au cours de la saison sportive. »

Le modèle applicatif ne propose que U12 à Vétéran (pas U8/U10, conforme au
glossaire SPEC.md §1), et fusionne Vétéran 1/2 du règlement en une seule
catégorie « Vétéran » (40 ans et plus) — le seuil des 5 participants pour
ouvrir un classement Vétéran 2 séparé (règlement) est une règle de
classement fédéral hors périmètre v1, dans l'esprit d'ADR-006.

**Calcul :** la saison sportive commence le 1ᵉʳ septembre. Année de
référence `N` = année civile de `competition.starts_on` si le mois est
janvier–août, sinon année suivante (vérifié sur l'exemple du règlement :
01/09/2021 et 31/08/2022 donnent tous les deux `N = 2022`). Pour une
tranche `[âgeMin, âgeMax]` : `birth_year_min = N - âgeMax`,
`birth_year_max = N - âgeMin` (Vétéran, borne haute ouverte :
`birth_year_min = null`, `birth_year_max = N - 40`). Ces bornes restent de
purs indicatifs non bloquants (ADR-005) : l'organisateur peut toujours les
ajuster à la main après application du modèle.

**Source :** texte du règlement FFME fourni par l'utilisateur en
conversation le 2026-09-16 — à vérifier auprès de la FFME avant une
compétition officielle si le règlement a changé depuis.

---

## ADR-026 — Lot 4 : le PIN juge devient une option de la compétition, désactivée par défaut

**Date :** 2026-09-16
**Contexte :** `ROADMAP.md` Lot 4 et `SPEC.md` § 3.2 imposaient un PIN à 6
chiffres systématique pour chaque juge (« Un lien seul... ne permet pas de
noter »). Demande explicite de l'utilisateur en ouverture de ce lot :
le PIN doit devenir une **option, désactivée par défaut**. Trois points
précisés en conversation avant l'implémentation.

**Décision 1 — portée du réglage : par compétition, pas par juge.**
`competition.judge_pin_required` (`boolean`, défaut `false`), éditable à
tout moment via `PATCH /competitions/:id`. Option écartée : un réglage par
juge (case à cocher à la création de chaque juge) — plus flexible en
théorie, mais l'utilisateur a préféré un seul interrupteur, plus simple à
comprendre d'un coup d'œil dans l'onglet Juges.

**Décision 2 — le réglage n'est qu'une valeur par défaut, jamais
rétroactive.** Il ne s'applique qu'aux juges créés APRÈS le changement.
Un juge déjà créé garde l'état qu'il avait à sa création (`judge.pin_hash`
nullable, seule source de vérité pour CE juge — pas un flag séparé). Option
écartée : appliquer le changement immédiatement à tous les juges existants
(générer un PIN pour tous d'un coup si on active, invalider les PIN existants
si on désactive) — écartée par l'utilisateur, jugée trop perturbante en cours
de préparation d'une compétition.
**Conséquence directe** : un juge créé sans PIN n'a pas d'action « ajouter un
PIN » a posteriori (seulement « régénérer » un PIN qui existe déjà) — sinon
on retombe dans le cas que cette décision a justement écarté. Si le besoin
apparaît, noté dans `TODO.md`.

**Décision 3 — écran `/j/<token>` sans PIN : confirmation explicite, jamais
d'authentification au chargement.** Quand `pinHash` est `null`, la page
affiche « Bonjour `<nom>` » avec un bouton **« Commencer »** ; c'est le clic
(un `POST /judge/auth`) qui authentifie, jamais le `GET` initial de la page.
Décision prise par extension d'ADR-020 (« un `GET` ne doit jamais avoir
d'effet de bord ») plutôt que redemandée à l'utilisateur : un scanner
anti-hameçonnage ou un préchargement de navigateur qui visite le lien
authentifierait le juge à sa place si le simple chargement suffisait.

**Risque assumé, documenté explicitement** : pour une compétition où
`judge_pin_required = false`, l'invariant énoncé en `SPEC.md` § 3.2 (« un
lien seul, photographié ou retrouvé par terre, ne permet pas de noter ») est
rompu par construction — le lien seul suffit. C'est un choix conscient de
l'utilisateur, pas un oubli ; `SPEC.md` § 3.2 et § 6.4 sont mis à jour pour
le refléter comme conditionnel plutôt que garanti.

**Décision 4 (dérivée, non discutée explicitement) — JWT juge = identité
seule, jamais de portée (voies) embarquée.** Le JWT juge (`sub` = judge.id,
`competitionId`) vit plusieurs jours (fin de compétition + 12h), contrairement
au JWT organisateur (15 min). Lui faire porter la liste des voies assignées
aurait rendu une réaffectation ou une révocation invisibles jusqu'à
expiration — contraire à SPEC.md § 3.2 (« un juge révoqué est déconnecté au
prochain appel »). `requireJudge` (`apps/api/src/middleware/judge-auth.ts`)
recharge donc le juge depuis la base à **chaque** appel, et
`assertJudgeAssignedToRoute` (`apps/api/src/lib/judge-authorization.ts`)
revérifie l'assignation à la voie en base à chaque fois plutôt que de faire
confiance à un état capturé à l'authentification.

**Décision 5 (dérivée) — la planche de QR codes ne peut être générée qu'à
partir des jetons que le client détient encore lui-même.** `judge.access_token_hash`
est un hash, jamais réversible (SPEC.md § 5) : le serveur ne peut donc
jamais reconstruire un QR individuel après coup depuis la base. `POST
.../qrcodes.pdf` (pas un `GET`, ce n'est pas une ressource relisible à
volonté) prend en entrée les couples `{judgeId, accessToken}` que
`JudgesTab.vue` garde en mémoire pour la durée de la session (jamais
persisté), revérifie chaque jeton contre son hash en base avant de l'inclure,
et n'imprime en encart individuel que les juges ainsi fournis — les autres
n'apparaissent que via la page QR publique de la planche (celle-ci lit
`competition.public_slug`, qui n'est pas un secret à usage unique). Un
organisateur qui veut la planche complète doit donc la télécharger dans la
même session que la création des juges, ou régénérer un PIN/recréer un juge
pour le réintégrer à une planche ultérieure.

**Réponse à la question posée par `ROADMAP.md` Lot 4 — que se passe-t-il si
l'organisateur perd le PIN d'un juge en cours de compétition ?**

- **S'il a un PIN** : `POST .../judges/:jid/regenerate-pin` génère un
  nouveau PIN (affiché en clair une seule fois, même encart que la
  création), remet `pin_attempts`/`locked_until` à zéro. Le **jeton** ne
  change pas : un juge déjà authentifié sur un appareil (JWT déjà émis)
  n'est pas déconnecté — seule une nouvelle authentification (nouvel
  appareil, ou après revocation locale du navigateur) a besoin du nouveau
  PIN.
- **S'il n'a pas de PIN et que le lien est perdu/compromis** : pas de
  régénération de token (cf. Décision 2 — pas d'action prévue pour ce cas
  précis). Seul recours : `POST .../judges/:jid/revoke` puis recréer un
  juge (nouveau lien, nouveau QR à réimprimer et à redistribuer).

**Options écartées (techniques) :**

- Chiffrement réversible du token plutôt qu'un hash, pour permettre de
  régénérer la planche à tout moment — écarté, contredit littéralement
  `SPEC.md` § 5 (« en base, seuls les hachés argon2id »), une exigence de
  sécurité explicite, pas un détail d'implémentation.
- `randomToken` (`packages/db/src/crypto.ts`) corrigé à cette occasion
  (échantillonnage par rejet plutôt que `byte % 62`) — résout l'entrée de
  `TODO.md` qui demandait explicitement ce correctif avant que les jetons
  d'accès juge n'en dépendent.

---

## ADR-027 — PIN et token juge conservés en clair, consultables à tout moment (option par compétition, activée par défaut)

**Date :** 2026-09-17
**Contexte :** demande explicite de l'utilisateur après un premier essai du
Lot 4 : pour un petit club qui organise des contests sans enjeu important,
devoir noter le lien et le PIN de chaque juge au moment précis de sa
création (avant qu'ils ne disparaissent, ADR-026) est peu ergonomique —
surtout en créant plusieurs juges d'affilée. L'utilisateur demande de les
conserver en clair par défaut, consultables à tout moment depuis l'écran
organisateur, avec une option pour revenir au comportement du Lot 4 (haché
uniquement) si besoin.

**Objection soulevée avant implémentation** : conserver ces secrets en clair
en base affaiblit la garantie de `SPEC.md` § 5/§ 6.4 (« en base, seuls les
hachés argon2id ») — une fuite de la base ou d'une sauvegarde mal protégée
donne alors un accès direct à tous les juges de la compétition, au lieu de
nécessiter une attaque par force brute coûteuse contre un hash. Objection
maintenue mais non bloquante : l'utilisateur assume ce compromis pour son
cas d'usage réel (contests informels), et l'implémentation ci-dessous garde
deux garde-fous décidés unilatéralement pour limiter le risque résiduel,
sans redemander :

- masqué par défaut dans la liste des juges (bouton « Voir l'accès », pas
  affiché en permanence à l'écran) ;
- désactiver l'option **efface rétroactivement** le clair déjà stocké pour
  la compétition — sinon le bouton « désactiver » ne protégerait rien pour
  les juges déjà créés.

**Décision 1 — portée : par compétition, comme `judgePinRequired`.**
`competition.judge_credentials_stored` (`boolean`, défaut `true`), dans le
même onglet Juges que le réglage PIN, éditable à tout moment. Option
écartée : un réglage global au déploiement — l'utilisateur a préféré
qu'un même club puisse choisir différemment selon la compétition (un
contest informel vs. une compétition plus officielle).

**Décision 2 — colonnes séparées, jamais utilisées pour l'authentification.**
`judge.access_token_plain`/`judge.pin_plain` (nullable) s'ajoutent à
`access_token_hash`/`pin_hash`, qui restent l'unique source de vérité pour
`POST /judge/auth` et `requireJudge` (`apps/api/src/middleware/judge-auth.ts`,
`routes/judge-auth.ts` — aucun changement). Les colonnes `*_plain` ne
servent qu'à réafficher l'accès à l'organisateur
(`routes/judges.ts#toDetail`). Option écartée : chiffrement réversible du
hash plutôt qu'une copie en clair séparée — inutile ici, la demande est
explicitement d'avoir le clair, pas de le retrouver depuis le hash ; une
colonne séparée est aussi plus simple à effacer sélectivement (décision 4)
sans toucher au mécanisme d'authentification.

**Décision 3 — fixé par juge à l'action qui le produit, pas par la
compétition en continu.** Comme pour `judgePinRequired` (ADR-026), la
conservation en clair suit le réglage de la compétition **au moment de
l'action** (création ; régénération de PIN, qui suit le réglage _courant_,
pas celui de la création du juge — c'est une action ponctuelle, pas une
propriété figée du juge). Changer le réglage n'affecte jamais un juge déjà
créé pour l'action de création, mais s'applique à la prochaine régénération.

**Décision 4 — désactiver la conservation efface rétroactivement, activer
ne s'applique qu'aux actions futures.** `PATCH /competitions/:id` avec
`judgeCredentialsStored: false` met à `NULL`
`access_token_plain`/`pin_plain` pour tous les juges de la compétition, dans
la même transaction que la mise à jour du réglage
(`routes/competitions.ts`). L'inverse (activer) ne peut pas rattraper les
juges déjà créés : leur clair n'a jamais existé côté serveur, un hash n'est
pas réversible.

**Décision 5 — un accès révoqué n'a plus de raison de garder son clair.**
`POST .../judges/:jid/revoke` efface aussi `access_token_plain`/`pin_plain`
au passage — décision technique dérivée, non redemandée à l'utilisateur :
un accès mort ne devrait laisser aucun secret inutile traîner en base.

**Conséquence sur la planche de QR codes (ADR-026, Décision 5)** : un juge
dont le jeton est stocké en clair est désormais inclus automatiquement dans
`POST .../qrcodes.pdf`, sans que le client ait besoin de le fournir — la
limitation « seulement les juges de cette session » (ADR-026) ne s'applique
plus qu'aux juges créés avec `judgeCredentialsStored` désactivé pour cette
compétition.

---

## ADR-028 — Envoi de l'accès juge par e-mail, sans le PIN

**Date :** 2026-09-17
**Contexte :** demande explicite de l'utilisateur, dans la continuité de
ADR-027 : un champ e-mail optionnel à la création d'un juge, qui envoie le
lien d'accès directement plutôt que de forcer l'organisateur à le
retransmettre à la main.

**Décision :** `createJudgeInputSchema` accepte un `email` optionnel. Si
fourni, `POST .../judges` envoie un e-mail (via le `Mailer` existant,
ADR-019) contenant **uniquement le lien**, jamais le PIN — tranché avec
l'utilisateur : si la boîte mail du juge est compromise ou l'e-mail mal
acheminé, les deux facteurs ne doivent pas fuiter ensemble, sinon le PIN
perd tout son intérêt de second facteur même dans ce flux. Le PIN reste à
communiquer à part (oralement, ou lu depuis l'écran organisateur via
« Voir l'accès », ADR-027).

L'envoi est **best-effort, jamais bloquant** : un échec SMTP n'annule pas la
création du juge (`try/catch` autour de `mailer.send`, `routes/judges.ts`)
— l'organisateur garde de toute façon l'accès affiché à l'écran. La réponse
porte un `emailSent: boolean` pour que l'écran organisateur informe
clairement du résultat plutôt que de laisser croire à un envoi silencieux
qui aurait échoué.

**Options écartées :** inclure le PIN dans l'e-mail pour plus de confort —
écartée par l'utilisateur, casse la séparation des deux facteurs.

---

## ADR-029 — `POST /judge/ascents` : un seul passage par requête, pas de lot batch avant le hors ligne

**Date :** 2026-09-17
**Contexte :** Lot 5 est en ligne uniquement ; batcher les écritures n'apporte
aucun bénéfice tant qu'il n'y a pas de file locale à vider.

**Décision :** l'endpoint de création de passage (`POST /judge/ascents`)
accepte un seul `ascent` par appel. Le Lot 6 introduira `POST
/judge/ascents/batch` aux côtés de la file de synchronisation hors ligne,
sans remplacer cet endpoint — les deux coexisteront : saisie isolée en
ligne, lot au retour de connexion.

**Options écartées :** concevoir dès maintenant un endpoint batch « au cas
où » — rejeté, contraire à `CLAUDE.md` (« un lot à la fois »).

---

## ADR-030 — Ouverture d'un tour : débloquée au minimum pour le Lot 5, le pilotage complet reste au Lot 8

**Date :** 2026-09-17
**Contexte :** en démarrant le Lot 5, constat qu'aucun tour ne peut jamais
atteindre `status = 'open'` dans le code existant — `round.status` vaut
`'draft'` à la création (tour explicite en format phases, comme round
implicite en format contest, ADR-023) et aucune route n'expose de
transition. `ROADMAP.md` attribue explicitement « ouverture/clôture des
tours, publication des résultats » au Lot 8. Sans déblocage, aucun juge ne
peut jamais voir un tour ouvert : le Lot 5 ne serait démontrable dans aucun
navigateur, ce qui contredit « définition de terminé » point 1 de
`CLAUDE.md`.

**Décision :** débloquer strictement la colonne déjà modélisée depuis le
Lot 1, sans construire la moindre pièce du tableau de bord Lot 8 (garde-fous
de transition, alertes, historique, publication des résultats) :

- **Format phases :** `status` ajouté à `updateRoundInputSchema`
  (`packages/contracts/src/round.ts`), accepté par le `PATCH
  /competitions/:id/rounds/:roundId` déjà existant — aucune nouvelle route,
  aucun bouton ajouté à `RoundsTab.vue` (l'organisateur n'a donc pour
  l'instant aucun moyen dans l'écran de le faire lui-même ; un appel API
  direct est nécessaire jusqu'au Lot 8).
- **Format contest :** le round implicite (invisible à l'organisateur,
  ADR-023, sans écran « Tours » pour l'ouvrir) passe automatiquement à
  `open` quand `POST /competitions/:id/status` fait passer la compétition à
  `running` (`apps/api/src/routes/competitions.ts`) — cohérent avec le
  principe déjà posé par ADR-023 que ce round est de la plomberie
  automatique, jamais une action organisateur explicite.

**Options écartées :** ajouter un bouton « ouvrir »/« clôturer » dans
`RoundsTab.vue` pour le format phases — discuté avec l'utilisateur, écarté
pour ne pas empiéter davantage sur le périmètre UI explicitement attribué au
Lot 8 ; la vérification manuelle du Lot 5 en navigateur ouvre le tour de
test par un appel API direct plutôt que par un bouton.

**Conséquence :** le vrai pilotage (garde-fous, alertes, publication) reste
entièrement à construire au Lot 8, qui devra aussi décider s'il expose une
transition `open → closed → published` pour le format contest ou si le
round implicite se referme avec la compétition elle-même — noté dans
`TODO.md`.

---

## ADR-031 — `ascent.superseded_by` : clé étrangère rendue différable (`DEFERRABLE INITIALLY DEFERRED`)

**Date :** 2026-09-17
**Contexte :** en implémentant la correction du juge (`POST
/judge/ascents/last/correct`, Lot 5), premier code du projet à réellement
chaîner une correction (`ancien.superseded_by = nouveau.id`). Deux
contraintes non différables du modèle (SPEC.md § 5, ADR-002) se
contredisent à l'écriture :

- l'index partiel `ascent_active_key` (`UNIQUE (round_id, route_id,
  competitor_id) WHERE superseded_by IS NULL AND conflict_group IS NULL`)
  exige que l'ANCIENNE ligne sorte de l'unicité (en lui donnant un
  `superseded_by`) AVANT que la NOUVELLE n'y entre — sinon les deux se
  disputent la même clé ;
- la clé étrangère `ascent_superseded_by_ascent_id_fk` exige que la ligne
  référencée par `superseded_by` existe déjà — donc que la NOUVELLE ligne
  soit insérée AVANT que l'ANCIENNE ne la référence.

Chaque contrainte impose l'ordre inverse de l'autre : sans intervention,
aucun ordre d'écriture ne satisfait les deux à la fois. Un index partiel ne
peut pas être rendu différable en PostgreSQL (seules les contraintes
ajoutées via `ADD CONSTRAINT` le peuvent, pas les `CREATE INDEX ... WHERE
...`) — testé aussi une CTE inscriptible combinant `UPDATE`+`INSERT` en une
seule requête, dans l'espoir que les contraintes ne soient vérifiées qu'à la
fin de la requête complète : échoue à l'identique en pratique, PostgreSQL ne
donne aucune garantie sur la visibilité mutuelle de deux sous-requêtes
manipulant la même table dans un même `WITH`.

**Décision :** rendre la clé étrangère différable
(`DEFERRABLE INITIALLY DEFERRED`), seule des deux contraintes qui le
permette. Migration `packages/db/drizzle/0004_ascent_superseded_by_deferrable.sql`
(+ `.down.sql`), écrite à la main comme les migrations « down » d'ADR-018 —
l'API `references()`/`foreignKey()` de Drizzle Kit (version utilisée par ce
projet) n'expose aucune option `DEFERRABLE`, donc rien à diffuser depuis
`schema.ts` : cette migration n'apparaît pas dans `drizzle/meta/_journal.json`
(comme les fichiers `.down.sql`), puisqu'elle ne correspond à aucun
changement de `schema.ts`. L'ordre d'écriture devient : `UPDATE` de
l'ancienne ligne (`superseded_by = <id généré côté client pour la
nouvelle>`, FK vérifiée seulement au `COMMIT`, retire immédiatement la ligne
de l'index partiel), puis `INSERT` de la nouvelle ligne (n'entre en conflit
avec rien, l'ancienne est déjà sortie de l'index) — voir
`apps/api/src/routes/judge-ascents.ts`.

**Risque assumé et noté (TODO.md) :** un futur `drizzle-kit generate` ne
connaît pas ce `DEFERRABLE` (absent de `schema.ts`) — à vérifier qu'il ne
choisit pas par erreur le même numéro `0004` si le dossier `drizzle/` n'est
pas encore synchronisé au moment où quelqu'un le lance.

**Options écartées :**

- CTE inscriptible combinant les deux écritures en une seule requête —
  testée, ne fonctionne pas (voir ci-dessus).
- Sortir l'ancienne ligne de l'unicité autrement qu'en pointant
  `superseded_by` vers la nouvelle (ex. un champ intermédiaire) — rejeté,
  complique le modèle pour contourner un problème que `DEFERRABLE` résout
  proprement et durablement (utile aussi au Lot 8, qui chaînera les
  corrections organisateur de la même façon).

---

## ADR-032 — Corrections en lot (`POST /judge/ascents/batch`) : `supersedesId` explicite, pas de résolution serveur de « la dernière saisie active »

**Date :** 2026-09-18
**Contexte :** Lot 6 (hors ligne). L'endpoint `POST /judge/ascents/last/correct`
(Lot 5) résout sa cible côté serveur (« la dernière saisie active de ce
juge »). En mode lot, un même appel peut mélanger créations et corrections
sur plusieurs compétiteurs, dans un ordre d'arrivée réseau qui ne reflète pas
l'ordre chronologique de saisie — et un lot peut être rejoué après un échec
partiel. « La dernière saisie active » n'a alors plus de sens univoque.

**Décision :** un item `correct` du lot porte un `supersedesId` **explicite**
(`packages/contracts/src/judge-ascents-batch.ts`) — le client sait déjà, au
moment de la saisie, quel `ascent.id` précis il corrige (visible dans Dexie).
Le serveur (`processCorrectItem`, `apps/api/src/routes/judge-ascents.ts`)
vérifie que la cible appartient bien au juge courant, n'est pas déjà en
conflit, et respecte encore la fenêtre de 5 minutes (ADR-007) — mais ne
tente plus de deviner la cible.

**Conséquence assumée :** le second volet d'ADR-007 (« ou jusqu'à la saisie
suivante, n'importe quel compétiteur ») n'est plus revérifiable de façon
fiable côté serveur en mode lot. Le client continue d'appliquer les deux
règles avant de proposer l'écran de correction (donc un juge ne verra jamais
l'option de corriger hors fenêtre) ; seul le filet de sécurité serveur se
limite désormais à la règle des 5 minutes pour ce chemin. `POST
/judge/ascents/last/correct` (Lot 5) reste inchangé et coexiste (ADR-029).

---

## ADR-033 — Détection de conflit d'`ascent` en lot : `SELECT ... FOR UPDATE` + rattrapage sur violation d'unicité, jamais de `DEFERRABLE`

**Date :** 2026-09-18
**Contexte :** Lot 6. Un item `create` de lot doit détecter si un autre
appareil a déjà un passage actif pour le même (tour, voie, compétiteur), et
si oui, conserver les deux lignes avec un `conflict_group` commun (cas
SPEC.md §9 #22) plutôt que d'échouer ou d'en écraser une.

**Décision 1 — pas de `DEFERRABLE` nécessaire.** Contrairement à
`superseded_by` (ADR-031), `conflict_group` ne porte aucune clé étrangère —
seulement l'index partiel `ascent_active_key` (ADR-002). L'ordre
`UPDATE` (sort l'ancienne ligne de l'index) puis `INSERT` (la nouvelle, avec
le même `conflict_group`) fonctionne dans l'ordre naturel, sans contournement.

**Décision 2 — un `SELECT ... FOR UPDATE` préalable ne suffit pas seul.**
Verrouiller la ligne active du triplet protège contre une course *si une
ligne existe déjà*. Mais `FOR UPDATE` ne verrouille rien tant qu'aucune ligne
n'existe : deux lots concurrents insérant chacun le **tout premier** passage
d'un compétiteur peuvent tous deux passer la vérification (rien à trouver,
rien à verrouiller) avant qu'aucun n'ait inséré, puis se disputer l'index
partiel à l'`INSERT` — l'un des deux reçoit une violation d'unicité Postgres.
Repéré par un test d'intégration utilisant deux requêtes HTTP réellement
concurrentes (`Promise.all`, pas deux items du même lot traités
séquentiellement) : `apps/api/src/routes/judge-ascents-batch.test.ts`,
« cas SPEC.md #22 (course réelle) ».

**Décision 3 — rattrapage par un seul réessai sur `isUniqueViolation`.**
`processCreateItem` retente une fois `createOrConflict` si l'insertion échoue
par violation d'unicité (`apps/api/src/lib/pg-errors.ts`). Au second passage,
le `SELECT` retrouve la ligne désormais commitée par l'autre transaction et
suit le chemin conflit normal — jamais un `rejected` qui perdrait
silencieusement la saisie perdante (règle d'or, SPEC.md § 6.3).

**Options écartées :** verrouiller une ligne « factice »/un advisory lock
Postgres par triplet avant l'insertion — écarté, plus complexe qu'un simple
réessai sur l'erreur déjà distinguée par `isUniqueViolation`.

---

## ADR-034 — `uuidv7` reste l'unique générateur d'id côté client, `packages/sync` reste sans dépendance

**Date :** 2026-09-18
**Contexte :** Lot 6. La file de synchronisation a besoin d'identifiants
uuid v7 (ordonnés dans le temps) pour chaque élément.

**Décision :** `packages/sync` ne génère aucun id lui-même — `enqueue(kind,
payload, id)` reçoit l'id de l'appelant. `apps/web` continue d'utiliser
`uuidv7` (déjà dépendance de `apps/web`/`packages/db` depuis le Lot 1/5,
utilisée dans `JudgeAscentEntry.vue`), sans nouvelle bibliothèque. Cohérent
avec ADR-014 : `packages/sync` reste à zéro dépendance de production, comme
`packages/scoring`.

---

## ADR-035 — Gel de l'ACTIVATION du service worker, pas de son installation

**Date :** 2026-09-18
**Contexte :** ROADMAP.md Lot 6 exige qu'une nouvelle version ne s'installe
jamais pendant qu'une saisie est en attente. `vite-plugin-pwa` était
configuré en `registerType: 'autoUpdate'` (Lot 1), qui bascule seul dès
qu'une mise à jour est prête.

**Décision :** `registerType: 'prompt'` — le plugin n'appelle plus jamais
`updateSW(true)` de lui-même. `apps/web/src/pwa-update.ts` pilote l'appel
manuellement via `virtual:pwa-register`, gated sur `packages/sync` : tant que
la file contient un élément `pending`/`sending`, `updateSW(true)` n'est
jamais appelé. Nuance assumée dans le nom de l'ADR : le navigateur *installe*
toujours un nouveau service worker en arrière-plan dès qu'il le détecte (rien
ne l'en empêche, et ce n'est pas dangereux tant qu'il ne prend pas la main) —
seule l'**activation** (`skipWaiting` + prise de contrôle + rechargement),
seul moment qui pourrait interrompre une saisie, est gelée.

**Dépendance ajoutée :** `workbox-window` (`apps/web`, version `7.4.1`,
alignée sur celle déjà résolue transitivement par `vite-plugin-pwa`) —
nécessaire pour que `virtual:pwa-register` se résolve à la construction ;
jusqu'ici jamais importé nulle part dans le code (le Lot 1 configurait
`VitePWA` sans jamais appeler `registerSW`), donc jamais détecté avant ce lot.

---

## ADR-036 — Une seule base Dexie par appareil, vidée au changement de juge détecté au bootstrap

**Date :** 2026-09-18
**Contexte :** Lot 6. IndexedDB est l'unique source de vérité côté juge
(ADR-012). Faut-il une base par juge, ou une base partagée par appareil ?

**Décision :** une seule base (`climbcontest-judge`, `apps/web/src/judge/local-db.ts`),
cohérente avec `judge-session.ts` qui ne garde qu'un seul jeton actif à la
fois sur l'appareil (pas de multi-session juge simultanée dans le
navigateur). `bootstrapJudge()` compare le `judge.id` reçu au `judgeId` déjà
enregistré dans la table `meta` ; s'ils diffèrent, la base est intégralement
vidée avant d'écrire le nouveau contenu — un changement de juge sur le même
appareil (recyclage d'une tablette de club) ne doit jamais mélanger les
files/caches de deux juges différents.

---

## ADR-037 — `onOnline()`/`onVisible()`/`onStartup()` réinitialisent le repli exponentiel, ne se contentent pas d'appeler `flush()`

**Date :** 2026-09-18
**Contexte :** Lot 6. Un élément ayant déjà échoué plusieurs fois porte un
`nextAttemptAt` pouvant aller jusqu'à 30 secondes dans le futur (repli
exponentiel plafonné, jitter complet). Un simple appel à `flush()` sur le
retour réseau respecte ce délai — donc un élément peut rester bloqué en
`pending` plusieurs secondes après un retour réseau **explicite**, contraire
à SPEC.md § 6.3 (« reprise automatique »). Repéré par un test e2e réel
(`judge-offline-sync.spec.ts`) qui restait bloqué sur « Synchronisation… »
plusieurs dizaines de secondes après le retour en ligne.

**Décision :** `SyncEngine.onOnline()`, `onVisible()` et `onStartup()`
appellent désormais `retryNow()` (`packages/sync/src/engine.ts`), qui remet
`nextAttemptAt` à `0` pour tout élément `pending` dont le délai n'est pas
encore écoulé, avant d'appeler `flush()`. Le repli exponentiel continue de
s'appliquer normalement entre deux déclencheurs explicites — seuls ces trois
événements (retour réseau, retour au premier plan, démarrage) court-circuitent
le délai, jamais un flush périodique interne qui n'existe pas.

---

## ADR-038 — Le routeur n'appelle plus `bootstrapSession()` (organisateur) pour les routes juge, et l'échec ne bloque plus jamais la navigation

**Date :** 2026-09-18
**Contexte :** Lot 6. `router.ts` (Lot 1) appelait `bootstrapSession()`
(tentative de restauration de la session organisateur via le cookie de
refresh) une fois, avant la PREMIÈRE navigation, quelle que soit la route
cible. Cet appel réseau n'était jamais protégé contre un échec de `fetch` au
niveau transport (coupure réseau totale, pas juste un 401) — une exception
non interceptée y rejetait toute la navigation, laissant un écran
**entièrement blanc**, y compris pour un premier chargement hors ligne d'une
route juge. Repéré en testant manuellement le rechargement hors ligne
(`page.reload()` en mode avion) d'un écran juge via le vrai navigateur —
violait directement CLAUDE.md (« aucun écran de juge ne doit dépendre d'une
requête réseau pour s'afficher »).

**Décision :** `router.beforeEach` (`apps/web/src/router.ts`) n'appelle plus
`bootstrapSession()` du tout pour un chemin commençant par `/j` (aucune
session organisateur n'y a de sens, SPEC.md § 3.2). Pour les autres routes,
l'appel est enveloppé dans un `try/catch` — un échec (réseau ou serveur)
dégrade proprement (SPEC.md § 6.1 : « public et organisateur… avec
dégradation propre ») au lieu de faire planter la navigation.

---

## ADR-039 — Confirmations de saisie juge : toast à 2 secondes (au lieu de 5) et pile plafonnée à 3

**Date :** 2026-09-18
**Contexte :** Lot 6. Une fois la saisie écrite en local sans attente réseau
(ADR-012), un juge peut enchaîner les confirmations bien plus vite qu'en Lot
5 (qui imposait une pause naturelle via l'aller-retour réseau). Le composant
`Toast` (Lot 1, `packages/ui`) rend un empilement vertical sans limite,
fixé en bas de l'écran — sur 360 px de large, plusieurs confirmations
successives (durée par défaut 5 s chacune) finissent par recouvrir les
boutons d'action du compétiteur suivant. Repéré par un test e2e réel
(10 saisies consécutives) où le bouton « Voir le récapitulatif » devenait
durablement inatteignable.

**Décision :** deux ajustements minimaux, sans toucher au comportement des
toasts pour le reste de l'application (organisateur, public) :
- `JudgeAscentEntry.vue` passe une durée explicite de 2000 ms (au lieu du
  défaut de 5000 ms) pour ses confirmations de passage/correction ;
- `useToast.ts` (`packages/ui`) plafonne désormais la pile à 3 notifications
  visibles simultanément (`MAX_VISIBLE_TOASTS`), en retirant les plus
  anciennes — un garde-fou général, pas spécifique au juge.

**Également corrigé au passage :** `JudgeAscentEntry.vue::confirm()` capturait
`mode.value` (`'create' | 'correct'`) **après** l'écriture optimiste
(`await rowState.submitCreate(...)`), qui fait basculer `mode` de façon
réactive dès qu'elle atteint Dexie (le compétiteur passe `ascent === null` →
non-null, la fenêtre de correction s'ouvre) — le texte du toast annonçait
alors systématiquement « Correction enregistrée ✓ », y compris pour une
toute première création. `submittedMode` est désormais capturé une seule
fois, avant le branchement create/correct. Couvert par un test de régression
(`JudgeAscentEntry.test.ts`).

---

## ADR-040 — Lot 7 : deux décisions produit actées avec l'utilisateur avant le codage

**Date :** 2026-09-18
**Contexte :** `ROADMAP.md` Lot 7 (page publique et temps réel) suppose deux
mécanismes qui n'existaient pas encore dans le dépôt à ce stade.

**Décision 1 — le format contest reste « provisoire » en permanence, jusqu'au
Lot 8, sans aucune action ajoutée ce lot.** `ROADMAP.md` demande un marquage
« provisoire » tant qu'un tour n'est pas `published`. Or rien ne permet à ce
jour de faire passer le round implicite d'un contest à `published` :
ADR-030 avait déjà laissé ce choix explicitement au Lot 8 (« le Lot 8 devra
décider s'il expose une transition open → closed → published… »), et même
le format phases n'a qu'un `PATCH` sans bouton organisateur. Deux options
soumises à l'utilisateur : (a) étendre le `PATCH` existant au round
implicite du contest et ajouter un unique bouton « Publier les résultats »
(léger empiètement sur le Lot 8, dans l'esprit d'ADR-030) ; (b) ne rien
ajouter, un contest reste « provisoire » pour toujours jusqu'au Lot 8.
**Choix : (b).** Zéro nouvelle route de mutation, zéro bouton organisateur
dans ce lot — uniquement de la lecture de `round.status` déjà en base
(`apps/api/src/lib/public-ranking.ts`). Un contest reste donc systématiquement
`provisional: true` tant que le Lot 8 n'a pas construit la vraie publication.

**Décision 2 — le détail « dépliable » par voie montre TOUS les tours
participés, pas seulement le dernier atteint.** `FinalRankEntry`
(`packages/scoring`) ne porte qu'un `reachedRoundId` — un seul tour par
compétiteur. Deux lectures possibles de SPEC.md §3.3 (« le détail des voies
par compétiteur ») : montrer uniquement le tour atteint (plus simple,
correspond directement à ce que renvoie le moteur), ou l'historique complet
(qualif + demi + finale, chacun avec ses voies). **Choix : l'historique
complet**, pour que le spectateur voie le parcours entier d'un grimpeur, pas
seulement sa dernière performance — cohérent avec le fait que le classement
final se départage justement sur les tours précédents (§4.4).
Implémentation : `assembleCategoryRanking` (`apps/api/src/lib/public-ranking.ts`)
inclut, pour chaque compétiteur, tous les tours dont le classement contient
son id — ce qui correspond exactement, par construction du roster en
cascade (qualifiés du tour précédent), à « tous les tours jusqu'à celui
atteint inclus », sans logique supplémentaire.

---

## ADR-041 — Lot 7 : synthèse DNS pour satisfaire la précondition de `rankRound`, écrite à l'endroit prévu par ADR-021

**Date :** 2026-09-18
**Contexte :** `rankRound` (format phases, `packages/scoring`) exige que
chaque compétiteur apparaisse dans le classement de CHAQUE voie du tour, y
compris en DNS — sinon il lève une erreur (« Incohérence entre les voies du
tour »). ADR-021 avait anticipé ce besoin sans l'implémenter, en le
renvoyant « au Lot 3/8 ». Aucune route de l'API n'appelait `rankRoute`/
`rankRound`/`rankFinal` avant ce lot — Lot 7 est donc, mécaniquement, le
premier appelant réel, pas un empiètement volontaire sur un autre lot.

**Décision :** `apps/api/src/lib/public-ranking.ts` calcule, pour chaque
tour contribuant au classement d'une catégorie, le roster attendu (la
catégorie entière au premier tour ; les qualifiés du tour précédent
ensuite, via `getQualifiers`), puis complète les lignes réelles de chaque
voie avec des `Ascent` DNS synthétiques (`mergeRosterWithDnsPlaceholders`)
pour tout membre du roster absent sur cette voie précise — jamais écrites
en base, affichage/calcul seulement. Cette synthèse n'existe que pour le
format phases : le format contest (`rankRoundContest`) n'a pas cette
contrainte de cohérence et combine librement des ensembles de compétiteurs
différents d'une voie à l'autre (`realAscentsOnly`, sans synthèse).

**Options écartées :** construire cette synthèse dans `packages/scoring`
lui-même — écarté, ce paquet reste volontairement sans accès à un « roster
attendu » externe (SPEC.md §4.6 : `rankRound` ne reçoit que des
`RouteRanking`, pas la liste des compétiteurs inscrits) ; la précondition
reste, comme documentée par ADR-021, une responsabilité de l'appelant.

---

## ADR-042 — Lot 7 : clarification d'ADR-013 — « SQL explicite » signifie le builder Drizzle, pas `db.query` relationnel

**Date :** 2026-09-18
**Contexte :** ADR-013 exige que la requête alimentant le classement public
soit écrite « en SQL explicite, via `sql\`\`\`` de Drizzle, pas via l'API
relationnelle ». En pratique, `apps/api/src/lib/public-ranking.ts` utilise
le query builder de Drizzle (`db.select({...}).from(...).where(...)`), pas
un littéral `sql\`\`\`` à la main.

**Décision :** ce choix respecte l'intention réelle d'ADR-013 — éviter
`db.query.X.findMany({ with: {...} })` (l'API *relationnelle*, qui peut
générer du N+1 invisible), pas interdire le query builder ordinaire, qui
compile déjà en une seule requête SQL plate et lisible (CLAUDE.md : « pas
d'ORM magique… les requêtes de classement sont écrites et lisibles »).
C'est exactement le style déjà en usage dans `apps/api/src/lib/readiness.ts`
et `apps/api/src/lib/judge-authorization.ts`, écrits avant ADR-013. Un
littéral `sql\`\`\`` à la main aurait ajouté un risque d'erreur (liaison
d'un tableau dans une clause `IN`) sans bénéfice réel ici. La seule requête
véritablement « chemin chaud » de ce lot (l'agrégat de classement) reste
néanmoins un `SELECT` unique par voie/tour, sans jointure relationnelle
imbriquée.

---

## ADR-043 — Lot 7 : pont `LISTEN/NOTIFY`, canal unique, invalidation de cache pilotée côté abonné

**Date :** 2026-09-18
**Contexte :** ADR-014 posait le principe (`LISTEN/NOTIFY`, pas un
`EventEmitter` en mémoire) sans détailler la forme exacte. Deux besoins
distincts partagent le même flux d'événements : la diffusion SSE aux
spectateurs et l'invalidation du cache de classement (`lib/public-cache.ts`).

**Décision 1 — canal unique** (`climbcontest_public_events`), payload JSON
= pointeur léger (`PublicStreamEvent`, `packages/contracts/src/public.ts`),
jamais un dump de données — le client SSE réagit en invalidant/relisant la
requête concernée (même chemin que le chargement initial et le repli en
sondage), pas en consommant un état poussé.

**Décision 2 — l'invalidation de cache est pilotée par le côté `LISTEN`
(`realtimeBridge.subscribeAll`, câblé une seule fois dans `app.ts`), jamais
par les routes d'écriture elles-mêmes.** Une route d'écriture
(`judge-ascents.ts`, `rounds.ts`, `routes.ts`, `competitions.ts`) appelle
`notifyPublic(tx, …)` — jamais `cache.invalidateCategory(...)` directement.
**Justification :** reste correct si l'API tourne un jour en plusieurs
workers (TODO.md) — chaque worker écoute son propre `NOTIFY` et invalide son
propre cache en mémoire, sans qu'aucune route d'écriture ait besoin de
connaître tous les caches des autres processus.

**Décision 3 — `notifyPublic` est toujours appelé avec `tx` (le client de
transaction), jamais `db`, dans les transactions déjà existantes.**
Postgres ne délivre un `NOTIFY` émis en transaction qu'au `COMMIT` — jamais
si la transaction échoue. C'est cette garantie native, vérifiée par un test
d'intégration dédié (`lib/realtime-bridge.test.ts`, « ne délivre RIEN pour
un NOTIFY émis dans une transaction annulée »), qui empêche un événement
fantôme pour une écriture qui a échoué — pas du code applicatif à
maintenir.

**Options écartées :** un canal par compétition — écarté, complexifie le
`LISTEN` (autant de commandes que de compétitions actives) pour un bénéfice
nul, le filtrage par `competitionId` se fait déjà en mémoire côté
`EventEmitter`.

---

## ADR-044 — Correction de SPEC.md §7 : `route_updated` manquait à la liste des événements SSE

**Date :** 2026-09-18
**Contexte :** SPEC.md §7 documentait `GET /public/:slug/stream` avec
seulement 2 des 3 événements — `ranking_updated`, `round_status_changed` —
alors que `ROADMAP.md` Lot 7, point 2, en demande explicitement un
troisième, `route_updated` (une voie éditée par l'organisateur — vidéo,
nom… — doit rafraîchir la liste des voies publique sans que le spectateur
recharge la page).

**Décision :** correction de spec, pas une décision d'architecture
(CLAUDE.md : « SPEC.md n'est pas sacrée »). SPEC.md §7 mis à jour pour
lister les trois événements.

---

## ADR-045 — Lot 8 : trois décisions produit actées avec l'utilisateur avant le codage

**Date :** 2026-09-18
**Contexte :** `ROADMAP.md` Lot 8 (pilotage jour J) laissait trois points
ouverts, tranchés avec l'utilisateur avant d'écrire le code.

**Décision 1 — tableau de bord organisateur par polling, pas SSE.**
`EventSource` ne peut pas porter le header `Authorization` du JWT
organisateur ; un mécanisme dédié (jeton signé en query param) aurait ajouté
un nouveau vecteur d'authentification à sécuriser et tester, pour un
bénéfice marginal (1-2 personnes connectées au tableau de bord, pas 300
spectateurs comme la page publique, Lot 7). `GET .../dashboard` est donc
rafraîchi par `useQuery({ refetchInterval: 8000 })` côté client
(`PilotageOverview.vue`), sans invalidation de cache serveur (contrairement
au classement public, ADR-013) : le volume de requêtes attendu ne le
justifie pas.

**Décision 2 — transitions de tour séquentielles, publication bloquée par
un conflit non résolu.** Graphe : `draft → open`, `open → closed`,
`closed → (open | published)`, `published → closed` — aucune autre
transition acceptée (`ROUND_STATUS_TRANSITIONS`,
`packages/contracts/src/round.ts`, réutilisé tel quel côté client pour
désactiver les boutons non pertinents et côté serveur pour refuser une
transition invalide, `lib/round-status.ts`). Publier est bloqué tant qu'un
`ascent.conflict_group` non résolu existe sur ce tour
(`roundHasUnresolvedConflicts`) — un classement publié ne doit jamais
reposer sur une donnée encore contradictoire. Le tour implicite du format
contest reçoit exactement les mêmes contrôles via le nouvel endpoint format-
agnostique `POST .../round-status/:roundId` (voir ADR-046) — ça répond au
TODO explicitement laissé par ADR-040.

**Décision 3 — motif toujours facultatif pour un changement de statut
compétiteur, y compris « présent ».** `ROADMAP.md` disait littéralement
« avec motif », mais l'utilisateur a précisé en session que même un statut
« lourd » (abandon, disqualifié) ne doit pas bloquer sur un motif vide —
c'est un choix de l'organisateur, pas une contrainte système.
`changeCompetitorStatusInputSchema.reason` est `optional().nullable()` sans
exception par valeur de statut.

---

## ADR-046 — Lot 8 : `POST .../round-status/:roundId`, pas `POST .../rounds/:roundId/status` — piège de montage Hono découvert en écrivant le test

**Date :** 2026-09-18
**Contexte :** en implémentant la route de transition de statut (ADR-045,
décision 2), le chemin RESTful naturel `POST
/competitions/:id/rounds/:roundId/status` semblait pouvoir cohabiter avec
`routes/rounds.ts` (monté sur le même préfixe `/competitions/:id/rounds`,
réservé au format phases par `requirePhasesFormat()` appliqué en
`app.use('*', ...)`), du moment que la nouvelle route est enregistrée dans
un routeur Hono séparé. Le test du format contest (round implicite,
ADR-023) a immédiatement échoué en 400 « Les tours ne se gèrent que pour
une compétition au format phases » — l'erreur venant précisément de
`rounds.ts`, qui ne définit pourtant aucun handler pour `/:roundId/status`.

**Cause :** Hono aplatit le middleware global d'un sous-routeur monté par
`app.route(prefix, subApp)` sur tout le sous-arbre `prefix + '/*'` au
moment du montage — ce middleware s'exécute pour **toute** requête dont le
chemin tombe sous ce préfixe, qu'un handler existe ou non à cet endroit
précis. Un `throw` dans ce middleware (`requirePhasesFormat()`, qui lève
plutôt que d'appeler `next()` puis constater un 404) produit donc une
réponse définitive avant même que Hono ait la moindre chance d'essayer un
autre routeur enregistré sur un préfixe plus large. Un middleware qui se
contente d'appeler `next()` sans handler correspondant, lui, laisserait
Hono retomber proprement sur le routeur suivant — d'où le fait que le
format **phases** fonctionnait déjà avec l'ancien chemin avant ce correctif
(le garde-fou n'y jette jamais), masquant le problème jusqu'au test contest.

**Décision :** la route vit à `POST /competitions/:id/round-status/:roundId`
(`routes/round-status.ts`), un segment qui n'est possédé par aucun routeur
existant — élimine la collision structurellement plutôt que de retoucher
`rounds.ts` (dont le garde-fou global reste correct pour son propre usage).

**Options écartées :**
- Convertir le garde-fou de `rounds.ts` en application route par route
  plutôt qu'en `app.use('*', ...)` global, pour libérer le chemin RESTful
  — écarté : touche un fichier stable et déjà testé pour un gain purement
  esthétique sur l'URL.
- Ajouter la route dans `rounds.ts` lui-même — écarté, `rounds.ts` est
  explicitement réservé au format phases (commentaire du fichier) et cette
  route doit rester format-agnostique.

---

## ADR-047 — Lot 8 : `activity_log` (nouvelle table) pour tours/compétiteurs, fusionné en mémoire avec `ascent_event` à la lecture

**Date :** 2026-09-18
**Contexte :** `ROADMAP.md` Lot 8, point 7, demande un journal d'activité
de la compétition, filtrable et exportable. `ascent_event` (Lot 5/6) existe
déjà mais est scopé à un `ascent` — aucune colonne `competition_id`
directe, et aucun événement non lié à un passage (changement de statut de
tour ou de compétiteur) n'a de table où se loger.

**Décision :** une table neuve `activity_log` (migration `0005`,
`competition_id` direct, `event_type` ∈ `{round_status_changed,
competitor_status_changed}`, `actor_type` ∈ `{organizer, system}`,
`entity_id` polymorphe sans FK — même style que `ascent_event.actor_id`),
plutôt que d'étendre `ascent_event` à des événements sans `ascent_id`
(aurait rendu la colonne `ascent_id` nullable, cassant l'hypothèse `NOT
NULL` sur laquelle s'appuient déjà les jointures existantes,
`lib/activity-log.ts`, `lib/conflicts.ts`).
`GET .../activity-log` (`fetchActivityLog`) fusionne les deux tables **en
mémoire** — `activity_log` directement, `ascent_event` jointe à `ascent`
pour filtrer par compétition — plutôt qu'un vrai `UNION SQL` : les deux
tables n'ont pas la même forme (`ascent_event` n'a pas de colonne
`competition_id`), et à l'échelle d'une compétition de club, fusionner et
trier deux listes déjà petites en JS est plus simple, tout aussi correct,
et cohérent avec l'absence de pagination serveur déjà actée ailleurs
(`TODO.md` Lot 3). Le journal inclut délibérément **tous** les
`ascent_event`, y compris les saisies juge normales (`eventType:
'created'`) — pas seulement les actions organisateur — pour pouvoir
répondre à une réclamation sur un résultat trois semaines plus tard, comme
le demande `ROADMAP.md`.

**Conséquence sur `judge.last_seen_at` (dérivée, voir aussi ADR-048) :**
sans rapport direct avec `activity_log`, mais découverte dans le même lot
en construisant l'alerte « juge muet » du tableau de bord — documentée
séparément.

---

## ADR-048 — Lot 8 : `judge.last_seen_at` devient un vrai battement de cœur, mis à jour par le middleware `requireJudge`

**Date :** 2026-09-18
**Contexte :** jusqu'ici, `judge.last_seen_at` n'était écrit qu'à la
connexion (`POST /judge/auth`, Lot 4) — jamais pendant la journée. L'alerte
« juge muet depuis 10 minutes » du tableau de bord (ROADMAP.md Lot 8) a
besoin d'un signal qui reflète l'activité réelle, pas seulement le moment
où le juge a scanné son QR code le matin : un juge connecté à 8h et actif
toute la journée se serait sinon affiché comme « muet depuis 8h ».

**Décision :** `requireJudge` (`apps/api/src/middleware/judge-auth.ts`) met
à jour `last_seen_at` à **chaque** appel authentifié réussi (bootstrap,
batch, etc.) — un seul point d'écriture, plutôt que dupliqué dans chaque
route juge. Accepte un seam `now: () => Date` optionnel (même convention
que `JudgeAscentRouteDeps`, ADR-007), fourni par `judge-ascents.ts` qui le
reçoit déjà de `AppDeps`.

**Risque assumé, non traité ce lot :** `POST /judge/auth` (connexion) et le
passage automatique du round implicite contest à `open`
(`routes/competitions.ts`, transition `running`) écrivent encore
`new Date()` en dur, sans passer par ce seam — sans conséquence
fonctionnelle en production, mais un test qui fige `now()` pour l'API et
attend une cohérence stricte avec l'horloge réelle sur CES deux chemins
précis doit avancer son horloge simulée depuis un point de départ proche du
« vrai » maintenant, pas une date arbitraire (piège rencontré en écrivant
`dashboard.test.ts` — voir le commentaire dans ce fichier). Noté dans
`TODO.md` : uniformiser ces deux écritures sur le seam `now` si un besoin
de précision plus fort apparaît.

---

## ADR-049 — Lot 8 : réutilisation de la logique de conflit/correction juge (`lib/ascent-write.ts`, `lib/ascent-correction.ts`), extraite de `judge-ascents.ts`

**Date :** 2026-09-18
**Contexte :** la saisie de secours organisateur et la correction
organisateur (ROADMAP.md Lot 8, points 2 et 4) ont besoin exactement de la
même mécanique que la saisie/correction juge : détection de conflit avec
verrouillage et retry sur violation d'unicité (ADR-033), chaînage
`superseded_by` sous contrainte différée (ADR-031). La résolution de
conflit (Lot 8, point 3) a en plus besoin d'une variante « plusieurs lignes
sources → une ligne gagnante » (2 sources, pas 1).

**Décision :** extraction plutôt que duplication — `createAscentOrConflict`
(`lib/ascent-write.ts`) et `supersedeToNewAscent`/
`resolveConflictByChoosing` (`lib/ascent-correction.ts`), généralisées sur
un acteur (`{kind:'judge', judgeId}` ou `{kind:'organizer', userId}`).
`judge-ascents.ts` est modifié pour appeler ces fonctions au lieu de les
inliner — comportement inchangé, vérifié par les suites de tests
existantes (`judge-ascents.test.ts`, `judge-ascents-batch.test.ts`,
`judge-ascents-correction.test.ts`), qui servent de filet de
non-régression avant/après l'extraction. Justification du choix (plutôt
que « tu ne réécris pas ce qui marche ») : dupliquer une logique de
concurrence aussi délicate (ADR-033) dans un troisième endroit aurait créé
un risque réel de divergence future, pire que le risque de l'extraction
elle-même (couverte par les tests existants).

**Écart assumé à `SPEC.md` §7 :** la spec esquissait `PATCH /ascents/:id`
hors du préfixe compétition. La correction organisateur vit à
`PATCH /competitions/:id/ascents/:id` (`routes/organizer-ascents.ts`) pour
réutiliser `requireCompetitionAccess` comme toutes les autres routes
organisateur, plutôt que d'inventer une vérification d'accès dédiée pour
cette seule route.

---

## ADR-050 — Lot 9 : les qualifiés d'un tour restent dérivés du classement, avec des garde-fous

**Statut :** remplacée par ADR-054 (2026-09-19, avant tout code).
**Date :** 2026-09-19
**Contexte :** `ROADMAP.md` Lot 9, point 1 (format phases de bout en bout).
Constat en explorant le code : `getQualifiers` n'est appelé que par le
classement public (`lib/public-ranking.ts`) ; `expectedCompetitors()`
(`lib/ascent-progress.ts`), qui alimente l'écran voie du juge, le bootstrap
hors ligne, le batch et le tableau de bord, renvoie **toute la catégorie**.
En demi-finale ou finale, un juge verrait donc aussi les non-qualifiés et le
serveur accepterait leur saisie.

**Décision (actée avec l'utilisateur) :** pas de table de « qualifiés
figés ». Le roster du tour N+1 est le résultat de `getQualifiers` sur le
classement du tour N, recalculé. Trois garde-fous le rendent sûr :

- ouvrir le tour N+1 est refusé tant que le tour N n'est pas `closed` ou
  `published` ;
- rouvrir le tour N est refusé une fois N+1 ouvert ;
- une correction organisateur d'un passage du tour N après l'ouverture de
  N+1 n'est acceptée que si l'ensemble des qualifiés recalculé est
  **identique** ; sinon elle est refusée avec un message qui dit quoi faire.
  Ce dernier point est un raffinement décidé pendant la planification : un
  blocage total de toute correction créerait une impasse, le graphe de
  statuts (ADR-045) n'autorisant pas N+1 → `draft`.

**Options écartées :** figer les qualifiés en base à l'ouverture de N+1
(nouvelle table, migration, cas « qualifié figé ≠ classement recalculé » à
afficher) ; dériver sans aucun blocage (une correction tardive pourrait
faire sortir un compétiteur qui a déjà grimpé la demi-finale).

**Point de règle encore ouvert :** en cas d'égalité à la limite, tous les
ex aequo sont qualifiés (SPEC.md §4.4, marqué 🟡 « à confirmer »). C'est ce
que fait déjà `getQualifiers`. Pas tranché en silence : à faire valider par
un juge fédéral via `RULES.md`, et affiché à l'organisateur.

---

## ADR-051 — Lot 9 : RGPD — export et purge manuels, avec rappel

**Date :** 2026-09-19
**Contexte :** SPEC.md §6.4 et §8 laissaient ouverte la politique de
conservation (proposition : archivage à 2 ans, purge à 5 ans). Les
compétiteurs sont majoritairement mineurs.

**Décision (actée avec l'utilisateur) :** aucune suppression automatique.
Deux actions explicites par compétition, réservées au propriétaire du club :
**export RGPD** (toutes les données personnelles, en JSON) et **purge**
(confirmation forte, une trace sans donnée personnelle est conservée).
L'interface affiche un rappel quand une compétition dépasse 2 ans, puis
5 ans.

**Options écartées :** job planifié qui anonymise à 2 ans et purge à 5 ans,
avec e-mail d'avertissement — plus conforme sans intervention, mais
irréversible sans action humaine sur des données de mineurs.

---

## ADR-052 — Lot 9 : vidéos téléversées — refus des formats exotiques, sans transcodage

**Date :** 2026-09-19
**Contexte :** `ROADMAP.md` Lot 9, point 3 : « transcodage ou refus des
formats exotiques ».

**Décision (actée avec l'utilisateur) :** refus, pas de transcodage. Pas de
ffmpeg dans l'image Docker (pas de file de jobs, pas d'état « en cours de
traitement »). Formats acceptés : mp4, mov, webm, vérifiés par la signature
réelle du conteneur et non par l'extension ; taille maximale configurable.
Envoi en morceaux reprenable, derrière l'interface `StorageAdapter`
(SPEC.md §6.1).

**Limite assumée :** sans `ffprobe`, le codec n'est pas vérifié — un mp4 dont
le codec n'est pas lisible par le navigateur sera accepté puis illisible. Le
guide organisateur devra le dire (H.264/AAC recommandé).

---

## ADR-053 — Lot 9 : un drapeau de route, jamais un préfixe de chemin, pour exclure la session organisateur

**Date :** 2026-09-19
**Contexte :** `apps/web/src/router.ts` sautait le bootstrap de session avec
`to.path.startsWith('/c')`. Ce test attrapait `/competitions/...`, si bien
qu'un F5 sur une route organisateur perdait la session (TODO.md § Lot 8).

**Décision :** ce qui n'a pas de session organisateur (`/j`, `/j/:token`,
`/c/:slug`, `/c/:slug/salle`) le déclare par `meta.skipOrganizerSession` sur
la route. Aucun test de préfixe de chemin pour décider d'un comportement
d'authentification. Couvert par `router.test.ts` et un rechargement réel dans
`e2e/organizer-pilotage.spec.ts`.

---

## ADR-054 — Lot 9 : les qualifiés sont figés à l'ouverture du tour suivant (remplace ADR-050)

**Date :** 2026-09-19
**Contexte :** ADR-050 gardait la liste des qualifiés dérivée du classement,
avec des garde-fous. En écrivant le code, un cas a fait tomber ce choix :
un qualifié à la limite (10ᵉ) se blesse en demi-finale et passe en
« abandon ». Le classement de qualification est recalculé sur les seuls
compétiteurs `registered`/`present` (`loadFullCategoryRoster`), donc il
disparaît du tour 1, et le 11ᵉ est promu en demi-finale sans que personne
l'ait décidé. Le même effet vaut pour une disqualification ou une
correction tardive. Question posée à l'utilisateur, qui a tranché de figer.

**Décision :** table `round_qualifier` (migration réversible). À la
transition d'un tour R vers `open`, pour chaque catégorie de R qui a un tour
précédent P, le serveur calcule `getQualifiers(classement de P,
P.qualifyingCount)` et enregistre la liste : compétiteur, rang obtenu,
`frozen_at`, auteur. Cette liste fait foi pour R : écran juge, bootstrap
hors ligne, refus d'une saisie hors liste, tableau de bord, classement
public. Rien ne la recalcule ensuite — un abandon, une disqualification ou
une correction de P ne promeut ni n'exclut personne.

- **Un tour sans liste figée reste calculé à la volée** (repli inchangé) :
  les tours ouverts avant ce lot, et le premier tour de chaque catégorie.
  Aucun rattrapage de données n'est fait.
- **Ouvrir R exige que chaque tour précédent de ses catégories soit `closed`
  ou `published`**, sinon 409 avec le nom du tour à clore.
- **Rouvrir P est refusé dès qu'un tour suivant de la même catégorie est
  `open`/`closed`/`published`** : sa liste figée serait périmée.
- **Sortie de secours : `open → draft` et `closed → draft`, uniquement si le
  tour n'a aucun passage actif ni conflit.** Ouvrir un tour trop tôt n'est
  plus une impasse : on le remet en préparation (la liste figée est
  supprimée), on corrige P, on referme P, on rouvre R (nouvelle liste).
  Extension du graphe d'ADR-045, seule autre transition ajoutée.
- **Égalité à la limite** : tous les ex aequo sont qualifiés (SPEC.md §4.4 🟡,
  comportement de `getQualifiers`) ; la liste figée peut donc dépasser
  `qualifyingCount`, et l'interface le dit (« 11 au lieu de 10 : égalité »).
- **Une correction de P après la figeage change son classement mais pas la
  liste de R.** Assumé : la liste de départ d'un tour ne bouge pas une fois
  le tour ouvert. Le classement final reste calculé par le moteur à partir
  des tours.
- La figeage est tracée : le `activity_log` existant (`round_status_changed`)
  reçoit le nombre de qualifiés par catégorie dans son `payload`, sans
  nouvelle valeur de `event_type`.

**Options écartées :** rester dérivé avec « ignorer le statut pour la
dérivation » (le classement affiché d'un abandon après passage change de
comportement, un disqualifié garde ses passages dans le calcul) ; rester
dérivé et documenter le risque (un classement peut changer silencieusement le
jour J).

---

## ADR-055 — Lot 9 : le client juge actualise ses voies quand sa file est vide

**Date :** 2026-09-19
**Contexte :** `bootstrapJudge()` (Lot 6) ne tourne qu'à la connexion
(`JudgeAccess.vue`). En format phases, un juge connecté le matin garde le
cache de la qualification : quand la demi-finale s'ouvre, sa voie reste vide
(« aucun tour ouvert ») jusqu'à ce qu'il rouvre son lien. Relancer le
bootstrap tel quel efface `routeDetails` puis le réécrit, ce qui détruirait
l'état « fait » optimiste des saisies encore en file. Question posée à
l'utilisateur, qui a choisi l'actualisation sûre.

**Décision :** le bootstrap peut être relancé en journée, à trois
conditions cumulées :

- **Déclencheurs** : démarrage de l'application, retour du réseau, retour au
  premier plan (les mêmes que la file, `sync-runtime.ts`), plus un bouton
  « Actualiser mes voies » sur l'accueil juge. Au plus une actualisation
  automatique toutes les 30 s.
- **File vide** : aucun élément `pending` ou `sending` dans la file. Les
  éléments `conflict` et `rejected` ne bloquent pas — le serveur les a déjà
  traités, ils restent affichés par la file.
- **Vérifié dans la transaction d'écriture**, pas avant le téléchargement :
  `bootstrapJudge({ onlyIfQueueIdle: true })` relit la table `queue` à
  l'intérieur de la transaction Dexie qui réécrit `routeDetails`. Une saisie
  enregistrée pendant le téléchargement fait renoncer à l'écriture ; une
  saisie qui arrive après attend la fin de la transaction et applique son
  écriture optimiste sur les données fraîches. Jamais d'écrasement.

Quand des saisies sont en attente, l'actualisation est simplement reportée :
elle est retentée dès que la file se vide.

**Options écartées :** rouvrir le lien à la main à chaque changement de tour
(procédure documentée seulement — un juge qui oublie reste devant une voie
vide, sous pression) ; actualisation périodique inconditionnelle (risque
d'écraser des saisies en attente).

**Limite assumée :** le juge voit le nouveau tour au prochain retour au
premier plan ou en appuyant sur le bouton, pas instantanément — pas de
poussée serveur vers les juges (SSE) dans ce lot.

---

## Points encore ouverts (non tranchés dans ce Lot 0)

- ~~**RGPD — durée de conservation et de purge**~~ Tranché au Lot 9,
  ADR-051 (export et purge manuels, avec rappel à 2 et 5 ans).
