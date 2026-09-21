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

**Statut :** le gel est remplacé par ADR-061 (2026-09-20) ; `registerType: 'prompt'` et la dépendance `workbox-window` restent.
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
  traités. Mais ils ne suffisent pas à rester visibles : voir « Conservation »
  ci-dessous.
- **Vérifié dans la transaction d'écriture**, pas avant le téléchargement :
  `bootstrapJudge({ onlyIfQueueIdle: true })` relit la table `queue` à
  l'intérieur de la transaction Dexie qui réécrit `routeDetails`. Une saisie
  enregistrée pendant le téléchargement fait renoncer à l'écriture ; une
  saisie qui arrive après attend la fin de la transaction et applique son
  écriture optimiste sur les données fraîches. Jamais d'écrasement.

Quand des saisies sont en attente, l'actualisation est simplement reportée :
elle est retentée dès que la file se vide.

**Conservation des saisies en conflit ou rejetées (correction faite en
écrivant le test e2e).** La première version supposait qu'un élément
`conflict`/`rejected` « reste affiché par la file » après l'actualisation. Faux :
`judge-conflict.spec.ts` a échoué. Le serveur n'a aucun passage *actif* pour
un conflit (les deux lignes sont hors classement tant que l'organisateur n'a
pas tranché), donc le cache frais remettait le compétiteur en « À faire », et
seule la ligne « Fait » affiche l'avertissement de conflit : le juge aurait pu
ressaisir un compétiteur en conflit sans rien voir. Parade
(`preserveHeldAscents`, `judge/bootstrap.ts`) : pour un élément `conflict` ou
`rejected`, la saisie locale est conservée telle quelle dans le cache, *pour
le même tour uniquement*, et jamais à la place d'un passage que le serveur
connaît. La connexion (sans `onlyIfQueueIdle`) repart toujours de la vérité du
serveur, comme avant.

**Options écartées :** rouvrir le lien à la main à chaque changement de tour
(procédure documentée seulement — un juge qui oublie reste devant une voie
vide, sous pression) ; actualisation périodique inconditionnelle (risque
d'écraser des saisies en attente).

**Limite assumée :** le juge voit le nouveau tour au prochain retour au
premier plan ou en appuyant sur le bouton, pas instantanément — pas de
poussée serveur vers les juges (SSE) dans ce lot.

---

## ADR-056 — Lot 9 : export JSON de sauvegarde et réimport

**Date :** 2026-09-19
**Contexte :** `ROADMAP.md` Lot 9, point 2 : « export complet de la compétition
en JSON (sauvegarde, réimport) ». Rien n'était précisé sur le contenu ni sur la
sémantique du réimport. Choix faits sans question à l'utilisateur, car
réversibles et sans conséquence sur les règles de compétition ; **à relire**.

**Décisions :**

- **Liste blanche de colonnes**, écrite à la main dans `packages/contracts`
  (`backup.ts`), jamais `select *`. Un secret ajouté plus tard à une table ne
  fuit donc pas dans l'export. Exclus : hachés et clairs des jetons/PIN juge,
  compteurs de PIN, mots de passe, sessions, jetons en attente, `public_slug`.
- **Incluses** : compétition, catégories, compétiteurs (avec année de naissance et
  licence — ce sont les données de l'organisateur, pas celles de la page
  publique), voies, tours, affectations, qualifiés figés, juges (nom et voies
  seulement), tous les passages y compris remplacés et en conflit, `ascent_event`,
  `activity_log`. La trace complète permet de répondre à une réclamation.
- **Vidéos téléversées : hors JSON** (fichiers binaires). `route.video_asset_id`
  n'est pas exporté ; le lien externe `video_url` l'est.
- **Réimport = une NOUVELLE compétition** : tous les identifiants sont
  regénérés (uuid v7), y compris ceux des passages (un id de passage est
  globalement unique : réimporter dans la même base entrerait en collision), un
  nouveau `public_slug`, le club de l'organisateur qui importe. Les
  identifiants présents dans les `payload` de `ascent_event`/`activity_log`
  sont remplacés par les nouveaux. Le statut d'origine est conservé.
- **Juges réimportés révoqués**, avec un jeton aléatoire jeté aussitôt :
  l'historique d'attribution des passages est conservé, mais aucun accès n'est
  restauré. L'organisateur recrée des juges avec de nouveaux QR. Pas de
  restauration silencieuse d'un accès à des appareils qu'on ne connaît plus.
- **Passages saisis par un organisateur** : rattachés à l'organisateur qui
  importe (la contrainte `ascent_recorded_by_check` exige un auteur). L'identité
  d'origine n'est pas exportée.
- **Aperçu puis validation** (`mode: preview | commit`, comme ADR-024) : le
  serveur revalide tout dans les deux modes ; l'écriture est une transaction
  unique, tout ou rien.
- **Validation** : schéma Zod versionné (`schemaVersion: 1`) puis contrôle
  d'intégrité référentielle et des règles que la base impose (dossards et
  numéros de voie uniques, forme d'un passage). Les erreurs sont en français et
  disent quoi corriger.
- **Limite de taille** du corps : 25 Mo.

---

## ADR-057 — Lot 9 : PDF de résultats en police standard, caractères non encodables translittérés

**Date :** 2026-09-19
**Contexte :** le PDF de résultats (`lib/exports/results-pdf.ts`) est généré par
`pdf-lib` avec la police standard Helvetica, qui n'encode que WinAnsi. Un
caractère hors de cet ensemble fait lever `encodeText`, donc l'export
échouerait à cause d'un seul nom (polonais, cyrillique, emoji…). Avec des
compétiteurs de toute origine, ça arrivera.

**Décision :** `toSupportedText` (`lib/exports/pdf-text.ts`) garde tout ce que
WinAnsi sait écrire (les accents français, « Œ », les guillemets), ramène une
lettre latine étendue à sa lettre de base (`č → c`, `Ł → L`), et remplace le
reste par `?`. Un export ne plante jamais à cause d'un nom.

**Options écartées :** embarquer une police Unicode (fichier de plusieurs
centaines de Ko à versionner, `fontkit` à ajouter, mise en page à revoir pour
les écritures non latines) — disproportionné pour une compétition de club.

**Limite assumée :** un nom en cyrillique ou en caractères asiatiques s'affiche
`????` dans le PDF. Le CSV et le JSON, eux, gardent le texte tel quel.

---

## ADR-058 — Lot 9 : téléversement de vidéos — protocole maison, stockage sur disque, S3 explicitement non livré

**Date :** 2026-09-19
**Contexte :** ADR-052 acte « refus sans transcodage, envoi reprenable, derrière
`StorageAdapter` (local-disk + s3-compatible) ». Deux précisions prises en
implémentant.

**Décision 1 — protocole d'envoi maison, sans dépendance.** Session d'envoi en
base (`asset_upload`), puis morceaux envoyés en `PATCH` avec l'octet de départ
déclaré (`Upload-Offset`). Un décalage entre l'octet annoncé et l'octet reçu
répond `409` avec l'offset attendu : le client se recale et reprend. Même
principe que tus, sans la dépendance ni le protocole complet.

**Décision 2 — `StorageAdapter` livré avec UNE implémentation, `local-disk`.**
L'interface est définie pour deux (SPEC.md §6.1), mais l'adaptateur S3 n'est
PAS livré : `STORAGE_DRIVER=s3` échoue explicitement au démarrage. Raison :
`CLAUDE.md` interdit le code simulé, et un adaptateur S3 sans test contre un
vrai serveur compatible S3 en serait un ; l'ajouter demande le SDK AWS, un
conteneur MinIO dans la CI et le mapping des morceaux sur l'envoi multipart
(parties de 5 Mio minimum). C'est un écart au plan de départ du lot,
signalé à l'utilisateur. Un seul déploiement (un VPS, un volume Docker) n'en a
pas besoin en v1.

**Décision 3 — vérification à la fin, sur le contenu réel.** À la fin de
l'envoi, la taille reçue doit égaler la taille déclarée, et la SIGNATURE des
premiers octets doit être celle d'un conteneur accepté (`ftyp` pour mp4/mov,
EBML pour webm). Le type MIME déclaré n'est jamais une preuve. Le fichier est
servi avec le type vérifié et `X-Content-Type-Options: nosniff`.

**Décision 4 — clé de stockage jamais dérivée d'une entrée client** :
`competitions/<competitionId>/videos/<assetId>`. Le nom de fichier d'origine
n'est pas conservé. L'adaptateur disque refuse toute clé qui sortirait de sa
racine.

**Décision 5 — un envoi terminé remplace le lien externe** de la voie
(`video_url` mis à null) ; supprimer la vidéo téléversée ne le rétablit pas.

**Décision 6 — lecture publique servie par l'API, avec `Range`**, sous
`/public/:slug/routes/:routeId/video`. Un `<video>` demande des plages d'octets ;
sans elles, pas de déplacement dans la vidéo.

**Limite assumée :** le codec n'est pas vérifié (ADR-052).

---

## ADR-059 — Lot 9 : revue de sécurité des trois frontières

**Date :** 2026-09-19
**Contexte :** `ROADMAP.md` Lot 9, point 4. Méthode : une **matrice automatique**
(`routes/security-matrix.test.ts`) construite depuis `app.routes` — une route
ajoutée sans être classée fait échouer le fichier, et une route classée dans un
préfixe hérite des contrôles de ce préfixe — plus des tests ciblés
(`security-hardening.test.ts`, `lib/*.test.ts`). Chaque défaut ci-dessous a été
démontré par un test qui échouait AVANT le correctif. Les tests ont aussi été
vérifiés en cassant volontairement le code (mutation) : ils échouent.

**Défauts trouvés et corrigés :**

1. **Adresse client falsifiable** (haute). `clientIp` prenait la PREMIÈRE entrée
   de `X-Forwarded-For`, que le client écrit lui-même : la limitation de débit
   se contournait en changeant d'« adresse » à chaque requête. Désormais la
   DERNIÈRE, ajoutée par Caddy. Suppose un seul proxy de confiance.
2. **XSS stockée par lien de vidéo** (haute). `z.url()` accepte `javascript:`.
   L'inscription étant ouverte, n'importe qui pouvait poser un tel lien sur sa
   propre compétition ; un clic d'un organisateur connecté sur la page publique
   exécutait du script dans l'origine de l'application, d'où le cookie de
   refresh donnait un jeton d'accès. Corrigé à trois niveaux : seul http(s)
   est stocké, une valeur héritée n'est jamais servie, la page revérifie.
3. **Quatre routes anonymes sans limitation de débit** (moyenne) :
   `verify-email`, `refresh`, `logout`, `invitations/accept` — contraire à
   SPEC.md §6.4. Plafonds larges pour `refresh`/`logout` (tout un club partage
   une adresse).
4. **Aucune limite de taille de corps** (moyenne) : un JSON de plusieurs
   centaines de Mio à `/auth/login` saturait la mémoire sans authentification.
   1 Mio par défaut ; l'import de sauvegarde (25 Mio) et les morceaux de vidéo
   (16 Mio) gardent leur propre limite.
5. **Injection de formule dans l'export CSV du journal** (moyenne) : un motif
   ou un nom commençant par `=` s'exécutait dans le tableur.
6. **Algorithme JWT non épinglé** (basse) : HS384/HS512 acceptés avec le bon
   secret. Seul HS256, le seul émis, est accepté.
7. **Aucun en-tête de sécurité** (basse à moyenne) : `secureHeaders` sur l'API,
   et sur l'application web un ensemble d'en-têtes dont une CSP stricte.

**Vérifié sain (avec test) :** jetons organisateur et juge jamais
interchangeables ; 404 (jamais 403 ni 200) sur la compétition d'un autre club ;
isolement entre DEUX compétitions d'un même club, sur les identifiants imbriqués
et sur les références du corps ; aucune route GET ne modifie de ligne (ADR-020) ;
aucune route publique ne répond 5xx à des paramètres hostiles ; le public ne
reçoit ni licence, ni année de naissance, ni secret.

**Vérifié par lecture, sans test dédié :** SQL toujours paramétré ; aucun
`v-html` ; cookie de refresh `httpOnly`, `SameSite=Lax`, `Secure` en
production ; clé de stockage jamais dérivée d'une entrée client ; aucune requête
sortante vers une URL fournie par un utilisateur (pas de SSRF).

**Ouvert, non corrigé** (voir `TODO.md`) : limitation de débit en mémoire, par
processus ; la planche de QR codes plante sur un caractère hors WinAnsi ;
conservation en clair des accès juge par défaut (ADR-027, choix assumé) ; pas
de trace dans le journal de la suppression d'une vidéo.

**Limite de la méthode :** une revue par l'auteur du code n'est pas une revue
indépendante. Une relecture par un tiers (`/code-review`) reste recommandée
avant la première compétition réelle.

---

## ADR-060 — Lot 9 : mode dégradé — ce que voit chaque acteur quand le serveur est injoignable

**Date :** 2026-09-19
**Contexte :** `ROADMAP.md` Lot 9, point 4. ADR-009 exclut un mode « zéro
internet » à construire : on suppose un accès internet, même médiocre. La
question est donc celle d'un serveur ou d'un réseau qui TOMBE en cours de
compétition. Audit fait acteur par acteur, puis corrigé et couvert par
`e2e/degraded-mode.spec.ts`.

| Acteur | Avant | Maintenant |
|---|---|---|
| **Juge** | Tout s'affiche depuis IndexedDB, saisies mises en file, bandeau honnête (Lot 6). | Inchangé — couvert par `judge-offline-sync.spec.ts`. |
| **Organisateur, tableau de bord** | Aucune gestion d'erreur : les chiffres restaient **figés, sans aucun avertissement**, l'organisateur croyait ses alertes à jour. | Bandeau rouge « Le serveur ne répond plus », avec l'heure des derniers chiffres, dès la 2ᵉ relance ratée (une seule relance au lieu de trois) ; disparaît tout seul au retour. |
| **Organisateur, connexion** | « Une erreur inattendue est survenue. » | « Impossible de joindre le serveur. Vérifiez votre connexion internet, puis réessayez. Rien de ce que vous avez déjà enregistré n'est perdu. » |
| **Organisateur, liste** | « Impossible de charger vos compétitions. » sans issue. | Le même message, et un bouton « Réessayer ». |
| **Public** | Le classement affiché restait, mais l'indicateur **restait sur « En direct »** si la connexion mourait sans que le navigateur le remarque (wifi perdu) : un indicateur menteur. | Un chien de garde sur le `ping` du serveur (25 s) : plus de 65 s sans signe de vie, ou événement `offline` du navigateur, et la page passe en « Reconnexion… » ; le dernier classement reste lisible ; « En direct » revient à la reconnexion. |

**Non traité, à savoir** (voir `TODO.md`) : un organisateur qui RECHARGE sa page
alors que le serveur est injoignable est renvoyé à l'écran de connexion, faute de
pouvoir restaurer sa session. Le message est désormais clair, mais il doit
attendre le retour du réseau pour continuer.

---

## ADR-061 — Lot 10 : une nouvelle version s'active tout de suite, la saisie en cours survit au rechargement

**Date :** 2026-09-20
**Contexte :** ADR-035 gelait l'activation d'une nouvelle version tant que la file
de synchronisation contenait un élément `pending` ou `sending` (`ROADMAP.md` Lot 6,
point 2 : « ne s'installe JAMAIS pendant qu'une saisie est en attente »). En
relisant le code pour comprendre pourquoi une appli restait périmée après un
`docker compose up --build` :

- **La file n'était pas en danger.** Chaque saisie est écrite dans IndexedDB avant
  tout réseau (ADR-012) ; l'état `sending` n'existe qu'en mémoire (`sendOne`, dans
  `packages/sync/src/engine.ts`) : en base l'élément reste `pending`, donc un
  rechargement en plein envoi le renvoie. Le serveur est idempotent sur l'`id`
  de la saisie (`apps/api/src/lib/ascent-write.ts`, statut `duplicate`). Recharger
  avec une file non vide ne perd rien.
- **Ce qu'un rechargement perdait vraiment, le gel ne le protégeait pas.** L'écran
  de saisie (`JudgeAscentEntry.vue`) garde prise, modificateur, TOP, statut et
  temps dans des `ref` en mémoire jusqu'à « Confirmer ». Avec une file VIDE — le
  cas courant — le gel était déjà ouvert et la mise à jour rechargeait la page
  en pleine saisie : valeurs perdues.
- **Le gel avait un coût.** Un appareil dont la file ne se vide pas (un élément qui
  échoue durablement, un envoi en cours) ne se met jamais à jour, sans que
  personne ne le voie.

**Décision :**

1. **Brouillon de saisie.** `apps/web/src/judge/ascent-draft.ts` (logique pure,
   validée par Zod à partir de `ascentShapeFields` du paquet de contrats) et
   `useAscentDraft.ts` (branchement sur l'écran). Un SEUL emplacement par
   appareil, `localStorage['climbcontest.judge.ascentDraft']`, qui contient
   `routeId`, `competitorId`, `baseAscentId` (`null` en création, l'`id` du passage
   corrigé en correction), les cinq valeurs et `savedAt`.
   - Écrit **de façon synchrone à chaque changement** (`watch` en `flush: 'sync'`),
     seulement s'il diffère de l'état de départ de l'écran ; revenir à l'état de
     départ efface le brouillon. Pas de délai de 500 ms comme `useFormDraft` : un
     rechargement dans cette fenêtre perdrait le dernier appui.
   - Restauré **dans l'étape « saisie », jamais dans le récapitulatif** : le juge
     revoit ses valeurs et confirme lui-même, rien ne part tout seul. Un message
     l'annonce par un **encart dans la page** (« Saisie retrouvée : vérifiez-la avant de
     valider. »), pas par un toast : vérifié à 360 px, le toast recouvrait la rangée
     Neutre / +, celle que le juge doit justement revérifier.
   - **Périmé au bout de 10 minutes** (`DRAFT_MAX_AGE_MS`, décision du 2026-09-20).
     Un `savedAt` dans le futur (horloge du téléphone reculée) est traité comme périmé.
   - **N'est repris que s'il désigne exactement cet écran** : même voie, même
     compétiteur, même `baseAscentId`, et numéro de prise ≤ nombre de prises de la voie.
     Le `baseAscentId` couvre le cas « saisie écrite dans la file, page rechargée avant
     l'effacement du brouillon » : le passage porte alors un autre `id` (ou n'est
     plus en création) et le brouillon est écarté, sans doublon ni valeur fantôme.
   - **Effacé après l'écriture durable dans la file** (jamais avant : si la page
     se recharge entre « Confirmer » et la fin de l'écriture IndexedDB, le brouillon
     est encore là et le juge revalide) ; **purgé quand l'appareil change de juge**
     (`resetJudgeDatabase`, ADR-036).
   - Un brouillon illisible, invalide ou incohérent (TOP avec une prise, DNS avec une
     prise…) est ignoré et supprimé, jamais « réparé ».
2. **Plus de gel.** `pwa-update.ts` appelle `updateSW(true)` dès que
   `onNeedRefresh` se déclenche, sans regarder la file. `registerType: 'prompt'`
   est conservé (c'est lui qui permet de piloter l'appel) ainsi que `workbox-window`.
3. **Organisateur et public inchangés** : ils n'ont pas de file, leur gel était déjà
   ouvert en permanence.

**Ce que ça change dans l'invariant de la ROADMAP :** ce n'est plus « une nouvelle
version ne s'active jamais pendant une saisie en attente », mais « aucune saisie
n'est perdue par une mise à jour » — celle déjà confirmée (IndexedDB) comme celle en
cours (brouillon).

**Conséquences et limites assumées :**

- Un rechargement en pleine saisie fait clignoter l'écran ; il ne coûte plus de données.
- Le brouillon est du **mieux-effort** : si `localStorage` est inaccessible
  (navigation privée, quota), la saisie non confirmée est perdue au rechargement,
  comme avant. La file, elle, reste en IndexedDB. Une valeur non confirmée n'est pas
  encore une « action de juge » au sens de `CLAUDE.md`.
- Quitter l'écran volontairement (« ← Retour à la voie ») **n'efface pas** le brouillon :
  il expire au bout de 10 minutes. Le message de restauration est là pour qu'un
  juge qui revient sur le même grimpeur ne valide pas une vieille valeur sans la voir.
- Deux onglets sur le même appareil partagent l'emplacement : le dernier qui écrit gagne.
- **Non traité** : compatibilité entre une nouvelle version du code et des éléments
  déjà en file écrits par l'ancienne (le schéma Dexie n'a qu'une version). À traiter
  le jour où le format d'un élément de file change (voir `TODO.md`).

**Alternatives écartées :**

- *Brouillon dans IndexedDB* : écriture asynchrone, la dernière valeur peut ne pas
  être écrite au moment du rechargement ; pour six valeurs, `localStorage` est synchrone.
- *Un brouillon par compétiteur* : s'accumule sans jamais se nettoyer ; un seul juge
  saisit un seul passage à la fois.
- *Geler seulement quand l'écran de saisie est ouvert* : demande un signal « écran
  occupé » global, et l'appareil reste périmé tant que le juge y reste.
- *Repasser en `registerType: 'autoUpdate'`* : supprime la maîtrise de l'appel
  pour un gain nul ; `pwa-update.ts` devient déjà trivial.

---

## ADR-062 — Lot 11 : recherche, filtres et tri de la liste des compétitions, côté navigateur

**Date :** 2026-09-20
**Contexte :** l'organisateur voulait retrouver une compétition par nom, statut ou
date. `GET /competitions` renvoie déjà toutes celles du club, triées par date de
début décroissante ; un club en a quelques dizaines.

**Décision :**

- **Tout se fait dans le navigateur**, sur la liste déjà chargée : pas de nouveau
  paramètre d'API, pas de requête à chaque frappe. La logique est pure
  (`apps/web/src/lib/competition-list-view.ts`), la date du jour est un paramètre.
- **Recherche** : nom et lieu, insensible à la casse et aux accents, tous les mots
  doivent être présents. **Statuts** : plusieurs à la fois ; *aucun statut choisi
  = aucun filtre* (pas de « tout décoché = liste vide »). **Date** : période sur la
  date de **début**, bornes incluses, et deux raccourcis qui se partagent la liste
  sans trou ni doublon : « À venir ou en cours » (`endsOn >= aujourd'hui`) et
  « Passées » (`endsOn < aujourd'hui`). « Aujourd'hui » est la date **locale**
  (`toLocalDay`), pas `toISOString()` : à 0 h 30 heure de Paris, la date UTC est
  encore celle d'hier.
- **Tri** : date, nom, statut, dans les deux sens (un seul sélecteur de six
  options, sans geste caché). Le statut suit le **cycle de vie** (brouillon,
  ouverte, en cours, clôturée, archivée), pas l'ordre alphabétique. Départage
  stable : date de début décroissante, puis nom, puis identifiant. Défaut : date
  décroissante, comme avant.
- **La vue vit dans l'adresse** (`?q=&status=&from=&to=&when=&sort=&dir=`) : le
  retour depuis une compétition retrouve la liste filtrée, un lien se partage.
  Une adresse modifiée à la main n'est jamais une erreur : le invalide est ignoré.
  Seul ce qui s'écarte du défaut est écrit.
- Les compétitions **archivées restent visibles par défaut** (décision du 2026-09-20).

**Limite assumée :** filtrer côté client suppose une liste de taille raisonnable. Au-delà
de quelques centaines de compétitions par club, il faudra filtrer côté serveur
(`TODO.md`).

**Alternatives écartées :** filtrage côté serveur (un contrat d'API et un aller-retour
réseau par frappe, sur un réseau de salle) ; « tout décoché » comme filtre vide.

---

## ADR-063 — Lot 11 : supprimer une compétition, en deux temps

**Date :** 2026-09-20
**Contexte :** l'organisateur voulait supprimer une ou plusieurs compétitions « et
leurs données ». Aucune route n'existait ; `competition.deleted_at` était filtré
partout mais jamais écrit. `CLAUDE.md` (règle n°3) : « toute saisie destructive est
réversible et laisse une trace » — une suppression définitive directe la violerait.
La purge RGPD (ADR-051) est une autre action : elle anonymise et **garde** la
compétition et ses résultats ; elle n'est pas modifiée.

**Décision (actée avec l'utilisateur) :**

1. **Corbeille** — `DELETE /competitions/:id` pose `deleted_at`. Réversible :
   `POST .../restore` remet la compétition exactement comme elle était. **Aucune
   confirmation** (ni à la mise à la corbeille ni à la restauration) : c'est la
   corbeille qui protège. La restauration est idempotente.
2. **Suppression définitive** — `DELETE .../permanent`, **uniquement depuis la
   corbeille** (409 « Pas dans la corbeille » sinon). Efface tous les fichiers puis
   toutes les lignes. **Une seule confirmation** dans l'interface (modale qui liste
   ce qui va disparaître, sans retaper le nom) : c'est la seule étape sans filet.
3. **Tout organisateur du club** peut faire les trois (pas `requireOwner`),
   contrairement à la purge RGPD. Hors club : 404, jamais 403.
4. **Garde-fou : refus seulement si `status = 'running'`** (409, avec le chemin à
   suivre : « Clôturez-la d'abord »). Le statut de compétition n'est qu'un libellé
   libre — seul `running` a un effet (il ouvre le tour implicite du format contest,
   ADR-030) ; `open`, `closed` et `archived` n'ont aucun effet fonctionnel et les
   transitions sont libres (`TODO.md`). Le refus se fait par une seule requête
   conditionnelle : un changement de statut concurrent ne la contourne pas.
   *Écarté :* refuser aussi si un tour est ouvert (plus fidèle à « un juge peut
   saisir »), sur décision de l'utilisateur.
5. **La trace survit** : la table `competition_deletion_log` (migration 0009,
   réversible) reçoit une ligne par étape (`trashed`, `restored`, `deleted`) avec le
   nom de la compétition et l'auteur. `competition_id` **n'est pas une clé
   étrangère**, pour survivre à la suppression définitive. Aucune donnée personnelle
   de compétiteur ou de juge.
6. **Accès juge coupé.** Les routes juge ne testaient que `judge.deleted_at` : un juge
   aurait pu continuer à saisir dans une compétition à la corbeille. Le lien QR, la
   connexion et toute session ouverte répondent maintenant 404 (« Cette compétition
   n'est plus disponible… Vos saisies restent enregistrées sur ce téléphone »). **Aucune
   saisie n'est perdue** : une erreur HTTP fait revenir toutes les saisies en file
   locale (`SyncEngine`), et elles remontent après restauration. La page publique
   respectait déjà `deleted_at`.
7. **Ordre de suppression.** Aucune clé étrangère n'a de `ON DELETE CASCADE` : la
   suppression vide 14 tables dans l'ordre des clés (`COMPETITION_OWNED_TABLES`). Un
   test compare cette liste au catalogue Postgres (récursivement) : **une table
   ajoutée plus tard sans être listée fait échouer la suite**. Les fichiers sont
   supprimés **avant** les lignes (comme la purge : une vidéo « introuvable » est
   bénine, un fichier oublié qui montre des mineurs ne l'est pas), tous les médias,
   y compris ceux déjà retirés d'une voie. Sans stockage configuré alors que des
   vidéos existent, la suppression est refusée : jamais « à moitié ».
8. **Plusieurs à la fois : pas de route « en lot ».** L'interface traite les
   compétitions une par une et rend un bilan en français de ce qui a été fait et de ce
   qui ne l'a pas été (`apps/web/src/lib/bulk-action.ts`). Le refus d'une compétition
   « En cours » ne bloque ni ne cache le succès des autres.
9. **Pas de purge automatique de la corbeille** (cohérent avec ADR-051, données de
   mineurs) : la page affiche seulement « à la corbeille depuis N jours ».

**Alternatives écartées :** suppression définitive directe avec retape du nom
(viole la règle n°3, et ne passe pas à l'échelle pour plusieurs compétitions) ; corbeille
vidée automatiquement au bout de 30 jours (irréversible sans action humaine) ;
`ON DELETE CASCADE` (réécrit 14 clés étrangères et rend un oubli silencieux) ; route
« en lot » (surface d'API et atomicité partielle à définir pour un gain nul).

---

## ADR-064 — La date de fin suit la date de début dans le formulaire de compétition

**Date :** 2026-09-20
**Contexte :** une compétition de club se déroule en général sur une seule journée ;
l'organisateur devait saisir deux fois la même date.

**Décision :**

- Quand l'organisateur **modifie la date de début** (création : `CompetitionCreate.vue` ;
  édition : onglet Infos), la date de fin **prend la même valeur**. Elle reste
  modifiable à la main ensuite, pour les compétitions sur plusieurs jours.
- **Toujours**, pas seulement quand la fin est vide : sur une compétition de deux jours,
  changer le début ramène donc la fin au même jour. Choix volontairement simple et
  prévisible (« la fin égale le début » plutôt qu'« on conserve la durée »).
- Branché sur l'événement de saisie de la date de début, **pas sur un `watch`** : un
  brouillon restauré (`useFormDraft`) remplit les deux champs d'un coup et ne doit pas
  voir sa date de fin écrasée. Un champ date vidé (saisie partielle) est ignoré.
- Aucun changement d'API : le schéma Zod garde `endsOn >= startsOn`.

**Alternatives écartées :** conserver la durée (décale la fin de 1 jour si la compétition
en durait 2 ; plus surprenant à expliquer) ; ne remplir la fin que si elle est vide (ne
sert pas à l'édition, où la fin est toujours déjà renseignée).

---

## ADR-065 — Lot 12 : le statut d'un tour se porte par catégorie, pas par tour

**Date :** 2026-09-20
**Contexte :** `round.status` était global. Dans une vraie compétition, des catégories
passent le matin et finissent le matin, d'autres l'après-midi : fermer la qualification
des U16 forçait à fermer celle des U18, et la demi-finale d'une catégorie attendait la
fin de la qualification de toutes les autres (garde-fou d'ADR-054 posé sur le tour
entier). Par ailleurs, le statut de *compétition* n'avait presque aucun effet
(`TODO.md` §Lot 11) : seul `running` faisait quelque chose (ADR-030).

**Décision (actée avec l'utilisateur) :**

1. **Le statut vit sur le couple (tour, catégorie)** : table `round_category(round_id,
   category_id, status)`, mêmes quatre valeurs et même graphe de transition
   (`ROUND_STATUS_TRANSITIONS`). **Une ligne absente vaut `draft`** : on n'écrit qu'à la
   première transition, donc rien à synchroniser avec `round_route` (contrairement au
   round implicite d'ADR-023). `round.status` est **supprimée** : une seule source de
   vérité.
2. **Les garde-fous d'ADR-054 s'appliquent par catégorie** : ouvrir la demi-finale des
   U16 exige la qualification des U16 `closed`/`published`, sans regarder les U18. Le
   figeage des qualifiés, la réouverture, le retour en brouillon et le blocage de
   publication par un conflit deviennent eux aussi par catégorie.
3. **Une transition peut viser plusieurs catégories d'un coup** (`categoryIds`), pour la
   compétition à une seule vague : un tap. Tout ou rien — un refus sur une catégorie
   refuse l'ensemble et la nomme.
4. **Le statut de compétition est conservé** (cinq valeurs) mais il **n'ouvre plus
   rien** : l'effet d'ADR-030 (`running` ouvre le tour implicite du format contest) est
   **retiré**. En contest comme en phases, l'organisateur ouvre et ferme chaque
   catégorie dans le pilotage.
5. **Garde-fou de cohérence** : le statut de compétition ne peut pas quitter `running`
   tant qu'un couple est `open` (409, avec le chemin à suivre). Ouvrir un couple sur une
   compétition qui n'est pas `running` la passe à `running` (tracé au journal
   d'activité). Cela supprime le piège « Clôturée avec un tour ouvert » et rend le
   garde-fou de corbeille (`running`, ADR-063) suffisant.
6. **Migration réversible** : le haut remplit `round_category` depuis l'ancien
   `round.status`, répliqué sur chaque catégorie liée au tour ; le bas recrée
   `round.status` avec **perte assumée** quand les catégories d'un tour divergent
   (`open` l'emporte dès qu'une catégorie est ouverte — une saisie en cours n'est jamais
   coupée —, sinon l'état le plus avancé). Un tour `open` sans aucune voie n'a pas de
   catégorie à qui répliquer son état : il redevient brouillon (sans conséquence, aucun
   juge ne peut y saisir). Sauvegarde JSON : version de schéma 2, la version 1 reste
   importable (le statut du tour est répliqué sur ses catégories).

7. **Une voie ne sert que dans un seul tour ouvert.** Avec un statut par catégorie, la
   qualification des U18 et la demi-finale des U16 peuvent se chevaucher, et l'écran juge
   ne sait montrer qu'un tour par voie (`resolveOpenRoundForRoute`) — le juge ne saurait
   plus qui grimpe. Ouvrir (ou rouvrir) une catégorie est donc refusé (409 « Voie déjà
   utilisée ») tant qu'une de ses voies sert déjà dans un autre tour ouvert. Cela règle
   aussi ce que `TODO.md` notait depuis le Lot 5 (deux tours ouverts sur la même voie,
   non détectés).
8. **Le couple n'existe que tant qu'une voie relie la catégorie au tour.** Le garde-fou du
   point 5 ne compte que les couples ouverts qui ont encore une ligne `round_route` : si
   l'organisateur retire toutes les voies d'une catégorie d'un tour ouvert, la ligne
   `round_category` reste mais n'est plus visible du pilotage, elle ne bloque donc pas la
   clôture.

**Limite connue :** le garde-fou du point 5 est une requête conditionnelle unique, mais
deux transactions simultanées (ouvrir une catégorie pendant qu'un autre organisateur
clôture la compétition) peuvent encore se croiser dans une fenêtre de quelques
millisecondes (niveau d'isolation `READ COMMITTED`). Rare à l'échelle d'un club ; noté
dans `TODO.md`.

**Alternatives écartées :** garder `round.status` et lui ajouter un statut par catégorie
(deux sources de vérité qui divergent — exactement le défaut qu'on corrige) ; ouverture
automatique du tour suivant quand le précédent se ferme (le figeage des qualifiés est
quasi irréversible, ADR-054 : on laisse le temps de trancher un conflit ou une égalité —
c'est le Lot 14, en un clic avec aperçu) ; supprimer le statut de compétition (le cap
produit — recherche publique de compétitions à venir / en cours / finies — en a besoin).

**Effets sur les ADR antérieurs :** remplace **ADR-030** (le statut « En cours » n'ouvre
plus le tour implicite du contest) ; précise **ADR-054** (ses garde-fous sont par
catégorie) et **ADR-063** point 4 (le refus de mise à la corbeille reste « En cours »,
qui ne peut plus coexister avec une catégorie ouverte que dans le sens inverse : ouvrir
une catégorie fait passer la compétition à « En cours »).

**Suite prévue, non engagée ici :** Lot 13 (visibilité public/privé, recherche publique ;
« privé » = non listé, lien direct valable) et Lot 14 (enchaînement guidé des tours).

---

## ADR-066 — Lot 15 : photo annotée de la voie

**Date :** 2026-09-20
**Statut :** les renvois au Lot 16 (détection par couleur) sont sans suite : le lot est abandonné, ADR-069.
**Contexte :** les juges reçoivent hors de l'application une photo de leur voie,
annotée à la main avec les numéros de prises. On la met dans l'application : l'organisateur
téléverse la photo et place les prises, le juge la consulte hors ligne depuis son écran de
saisie, l'organisateur imprime des fiches « voie ». La détection automatique des prises par
couleur est le Lot 16 (à régler sur de vraies photos) ; ce lot ne la prépare pas.

**Décision (actée avec l'utilisateur) :**

1. **Une photo par voie.** Une photo de mur commune à plusieurs voies se téléverse sur
   chaque voie, avec une annotation par voie. Plusieurs photos par voie : `TODO.md`.
2. **Numérotation par hauteur puis correction.** « Renuméroter de bas en haut » donne le
   numéro 1 à la prise la plus basse sur la photo ; l'organisateur corrige à la main
   (traversées, dévers, où la hauteur ne suit pas le parcours).
3. **La photo est ré-encodée en JPEG dans le navigateur** (côté long 1600 px, qualité 0,85) :
   orientation EXIF appliquée, GPS retiré, poids d'environ 300 Ko. Le serveur n'accepte que
   du JPEG et le vérifie sur les octets de signature (`FF D8 FF`), jamais sur le type
   déclaré (même principe que les vidéos, ADR-058). JPEG seul car `pdf-lib` n'embarque que
   PNG et JPEG pour les fiches.
4. **L'annotation est une liste de coordonnées, pas une image.** `route.photo_holds` (jsonb)
   contient `{ number, x, y }` avec `x` et `y` normalisés dans [0, 1] : indépendants de la
   résolution, corrigeables sans renvoyer la photo, dessinés en surimpression (écran juge)
   ou par `pdf-lib` (fiches). La photo est un `asset` de type `route_photo`
   (`route.photo_asset_id`), stockée par le `StorageAdapter` d'ADR-058.
5. **Verrou : photo et annotation sont figées dès qu'un passage existe sur la voie**
   (409, comme `hold_count`, ADR-004). Renuméroter en cours de compétition changerait le
   sens de « prise 12 » pour les juges qui ont déjà saisi. Corollaire assumé : un flou
   découvert après le premier passage ne peut plus être remplacé.
6. **Hors ligne : la photo vit dans IndexedDB** (Dexie version 2, table `routePhotos`), pas
   dans le cache HTTP du service worker. Le `NetworkFirst` de l'API expire au bout de 24 h,
   ce qui contredirait « aucun écran de juge ne dépend du réseau ». L'amorçage juge ne
   renvoie que l'identifiant et les prises ; le client télécharge l'image (en-tête Bearer)
   quand l'identifiant a changé, **en arrière-plan** : les voies sont utilisables sans
   attendre la photo. Un échec de téléchargement n'échoue pas l'amorçage et sera réessayé à
   l'actualisation suivante. La migration Dexie v1→v2 ne touche jamais à la file d'envoi
   (testée avec 12 saisies en attente). **Octets bruts (`ArrayBuffer`) et non `Blob`** : c'est
   ce qu'IndexedDB conserve de façon fiable sur les téléphones anciens ; le `Blob` d'affichage
   est reconstruit à l'ouverture du panneau. Une photo remplacée qu'on n'arrive pas à
   retélécharger est **retirée** du téléphone : elle ne correspond plus aux numéros annoncés.
7. **Juge : bouton visible « Voir la voie », panneau qui glisse depuis la droite,** zoom par
   boutons ×1/×2/×3 et défilement. Le balayage horizontal ferme le panneau en plus du bouton,
   jamais à la place (`CLAUDE.md` : pas de geste caché).
8. **Fiches voie : PDF côté serveur** (`pdf-lib`, comme `qrcode-pdf.ts`), une page A4 par voie
   ayant une photo. L'export JSON exclut photo et annotation, comme `video_asset_id`.

9. **Cohérence avec `hold_count`.** Une prise annotée ne peut pas porter un numéro supérieur au
   nombre de prises de la voie (le pavé du juge s'y arrête) : `PUT …/photo/holds` répond 400,
   et `PATCH /routes/:id` refuse (409) de descendre le nombre de prises sous la plus haute
   prise placée, plutôt que d'effacer des prises en silence. Une annotation partielle est
   acceptée (l'écran signale « 12 prises placées sur 15 »). **Remplacer la photo efface les
   prises** (elles étaient placées sur l'ancienne image) : l'écran le dit et demande
   confirmation avant. Un bouton « Utiliser N comme nombre de prises » reporte le nombre de
   prises placées dans le champ du formulaire ; il ne change la voie qu'à « Enregistrer »
   (et reste soumis au verrou d'ADR-004) — c'est la seule part du pré-remplissage du nombre
   de prises livrée ici, le reste (détection) est le Lot 16.
10. **Données personnelles.** Une photo de mur peut montrer des grimpeurs : la purge RGPD
    supprime les fichiers et vide `photo_asset_id` / `photo_holds`, l'export d'accès les
    liste (`personalData.photos`), et la suppression définitive d'une compétition les efface
    comme les vidéos (elle supprime tous les `asset` de la compétition).
11. **Points d'API :** `PUT/GET/DELETE /competitions/:id/routes/:rid/photo`,
    `PUT …/photo/holds`, `GET /competitions/:id/route-sheets.pdf[?routeId=]`,
    `GET /judge/routes/:id/photo`, et `photo: { assetId, holds } | null` dans le détail de
    voie de l'amorçage juge (`.default(null)` : un détail mis en cache par la version
    précédente n'a pas ce champ).

**Limites connues :**

- Aucune vraie photo de voie n'a servi : les tests et la capture utilisent une image
  synthétique (`apps/api/src/test-utils/wall.jpg`). La lisibilité des numéros sur de vraies
  photos (mur chargé, prises serrées) est à juger en conditions réelles ; les numéros se
  chevauchent si deux prises sont très proches, et le zoom ×2/×3 est là pour ça.
- La fiche PDF ne montre pas les prises non annotées et n'a pas de version noir et blanc
  dédiée (anneau blanc puis noir, pastille blanche : lisible imprimé en niveaux de gris,
  non vérifié sur papier).
- Le verrou après le premier passage empêche de remplacer une photo floue découverte le
  jour J.

**Alternatives écartées :** annotation « cuite » dans l'image (corriger un numéro obligerait
à renvoyer la photo) ; cache HTTP du service worker (expiration) ; protocole d'envoi par
morceaux (excessif pour environ 300 Ko, une requête `PUT` suffit) ; PNG et WebP côté
serveur (le client ré-encode toujours).

---

## ADR-067 — Photo de voie : choix à la création et recadrage avant l'envoi

**Date :** 2026-09-20
**Statut :** le point 5 (échec d'envoi : ouvrir la voie en modification) et la deuxième limite (« les prises se placent toujours après la création ») sont remplacés par ADR-068.
**Contexte :** avec ADR-066, la photo ne se téléversait qu'en modifiant une voie déjà
créée, et telle quelle : une photo de mur prise en large, ou avec un voisin dans le
cadre, n'était pas rattrapable (et le verrou après le premier passage empêche de la
remplacer le jour J). Demande de l'utilisateur : choisir la photo à la création de
la voie, et pouvoir la recadrer / zoomer après l'avoir choisie.

**Décision (points 1 et 2 actés avec l'utilisateur) :**

1. **Rectangle libre**, pas un cadre à proportions imposées : une voie est haute et
   étroite, un format fixe la couperait mal. On tire les quatre coins (cibles de
   48 px, flèches du clavier en équivalent, Maj = pas plus grand) ; zoom ×1/×2/×3
   avec défilement, comme le panneau du juge (ADR-066 point 7). À ×1 la photo tient
   **entière** dans l'espace disponible (mesuré, sinon sur téléphone on recadrait
   une photo dont on ne voit pas le bas). Sur écran tactile, glisser à l'intérieur
   de la zone fait défiler la vue zoomée : le déplacement de la zone à la souris est
   un confort, les coins font tout (CLAUDE.md : pas de geste caché).
2. **Même sélecteur partout** (`RoutePhotoPicker`) : à la création de la voie et dans
   « Remplacer la photo » de l'éditeur. Le recadrage est facultatif ; sans lui, le
   comportement d'ADR-066 est inchangé.
3. **Le recadrage est une zone normalisée** `{ x, y, width, height }` dans [0, 1] de
   l'image **orientée** (EXIF appliqué), comme les prises (ADR-066 point 4) :
   indépendante de la résolution. Il est appliqué par `resizeToJpeg` **avant** la
   réduction à 1600 px (`drawImage` source → cible) : on garde la résolution de la
   zone choisie. **Rien ne change côté serveur ni en base** : il reçoit toujours un
   JPEG, la zone n'est jamais stockée. Pas de migration.
4. **L'aperçu est produit par le même `resizeToJpeg`** (côté long 640 px) : ce qu'on
   voit est ce qui sera envoyé, et un fichier illisible est refusé **dès le choix**
   (avant : au clic sur « Envoyer »). Un fichier refusé n'est pas retenu.
5. **À la création, l'ordre est : réduire, créer la voie, envoyer la photo.** Réduire
   d'abord évite de créer une voie orpheline pour un fichier illisible. La photo passe
   par l'API existante `PUT …/routes/:rid/photo`, qui exige une voie : pas de nouveau
   point d'API. Si l'envoi échoue (réseau), la voie **existe** : l'écran le dit, ouvre
   la voie en modification et demande de re-choisir la photo — pas de doublon possible
   en recliquant sur « Ajouter ».
6. **Pas de dépendance ajoutée** : le recadrage tient en fonctions pures testées
   (`photo-crop.ts`) et un composant (`PhotoCropDialog.vue`).

**Limites connues :**

- Pas de rotation ni de redressement (l'orientation EXIF est déjà appliquée).
- Les prises se placent toujours après la création de la voie (elles dépendent de la
  photo finale et de son id) ; l'écran l'indique.
- Le glissement au doigt dans la zone ne la déplace pas (il fait défiler) : on la
  déplace en tirant deux coins. Vérifié en émulation mobile 360 px avec le pointeur
  souris de Playwright, **pas sur un vrai téléphone**.
- Le recadrage tactile (pincer pour zoomer) n'existe pas : le zoom est par boutons.

**Alternatives écartées :** cadre à proportions fixes avec déplacement de la photo
dessous (impose un format) ; bibliothèque de recadrage tierce (dépendance pour un
besoin de quatre coins) ; stocker la zone en base (le serveur n'en a pas l'usage, la
photo envoyée est déjà recadrée) ; endpoint unique « créer la voie avec sa photo »
(deux mécanismes d'envoi à maintenir pour un gain de deux requêtes).

---

## ADR-068 — Annoter la photo dès la création de la voie ; le nombre de prises suit l'annotation

**Date :** 2026-09-20
**Contexte :** retour de l'utilisateur après ADR-067 : la photo se choisit à la création **pour
que l'organisateur annote la voie tout de suite**, devant le mur, sans compter les prises. Le
nombre de prises de la voie doit se déduire de l'annotation, et **l'annotation prend le pas sur
le champ « Nombre de prises » s'il est déjà renseigné**.

**Décision :**

1. **Un déroulé en trois temps, dans cet ordre** (actée avec l'utilisateur) : choisir l'image →
   décider de la recadrer ou non → l'annoter. « Continuer sans recadrer » et la validation du
   dialogue de recadrage mènent à l'annotation. Ma première lecture (recadrer à tout moment,
   en recalant les prises) est abandonnée.
2. **Les prises se placent sur l'image finale, recadrage compris** (coordonnées normalisées,
   ADR-066 point 4). Revenir au recadrage depuis l'annotation est possible mais **efface les
   prises, après confirmation** (comme remplacer une photo, ADR-066 point 9). Choisir un autre
   fichier reprend au début.
3. **Le nombre de prises est celui de l'annotation.** Dès qu'une prise est placée, le champ
   « Nombre de prises » est remplacé par le plus haut numéro placé, avec la mention « D'après
   les prises placées sur la photo » et, si une valeur avait été saisie, « Remplace les N
   saisies ». Si on retire toutes les prises, le champ revient avec la valeur saisie. Une
   numérotation à trou (une prise oubliée) compte jusqu'au plus haut numéro, ce que
   `PUT …/photo/holds` exige (ADR-066 point 9) ; l'écran signale le trou. En modification d'une
   voie, rien ne change : « Utiliser N comme nombre de prises » reste explicite (ADR-066).
4. **Envoi en trois temps, reprenable :** voie (avec le nombre déduit), puis photo, puis prises.
   La photo est réduite AVANT de créer la voie (ADR-067). Si le réseau lâche en route, la voie
   créée est retenue : l'écran dit ce qui n'est pas parti, **garde la photo et les prises
   placées**, et « Ajouter » reprend (mise à jour de la voie, puis ce qui manque) sans créer de
   doublon. « Annuler » abandonne la reprise ; la voie reste dans la liste, modifiable.
   Remplace le comportement d'ADR-067 point 5, qui perdait les prises placées.
5. **Un composant commun `HoldAnnotator`** porte poser / glisser / renuméroter / numéro / clavier,
   utilisé par l'éditeur d'une voie enregistrée (avec plafond : le nombre de prises) et par la
   création (sans plafond). Extrait de `RoutePhotoEditor` avec l'accord de l'utilisateur ; les
   tests et l'e2e du Lot 15 passent inchangés. `RoutePhotoPicker` expose deux emplacements
   (`preview`, `actions`) pour composer ce déroulé.
6. **Aucun changement d'API ni de base :** trois appels existants (`POST /routes`,
   `PUT …/photo`, `PUT …/photo/holds`).

**Limites connues :**

- Trois requêtes : si l'onglet est fermé entre deux, la voie existe sans photo ou sans prises ;
  l'éditeur (Modifier) permet de terminer.
- ~~Les prises se placent sur un aperçu de 640 px de côté long, sans zoom : à vérifier sur un
  mur chargé (le zoom existe dans le recadrage, pas dans le placement, comme dans l'éditeur).~~
  **Levé au Lot 19, ADR-077 :** le placement a un zoom ×1/×2/×3 et un mode plein écran, à
  toutes les largeurs, et l'aperçu de création est passé à 1280 px.
- Vérifié en émulation mobile 360 px, **pas sur un vrai téléphone devant un mur**.

**Alternatives écartées :** créer la voie dès le choix de la photo (voies orphelines) ; recaler
les prises quand on recadre après coup (complexité pour un cas que le déroulé en étapes évite) ;
laisser le champ « Nombre de prises » modifiable à côté de l'annotation (deux sources de vérité,
c'est exactement ce que l'organisateur ne veut pas trancher).

---

## ADR-069 — Lot 16 abandonné : pas de détection automatique des prises

**Date :** 2026-09-20
**Contexte :** ADR-066 renvoyait au Lot 16 la détection des prises par couleur : l'organisateur
touche une prise pour échantillonner sa couleur, règle une tolérance, une détection par
composantes connexes propose des taches qui alimentent l'éditeur du Lot 15 (Web Worker côté
navigateur). Le lot était « à cadrer » et conditionné à de vraies photos de voies fournies par
l'utilisateur ; le seul fichier image du dépôt est synthétique (`wall.jpg`). Discuté avant tout
code.

**Décision (actée avec l'utilisateur) :** le Lot 16 est **abandonné**. Le placement manuel des
prises du Lot 15 (ADR-066, ADR-068) reste la seule façon d'annoter une voie.

**Raisons évoquées en discussion :**

- Le gain n'a jamais été mesuré : la détection économise la pose des prises, mais ajoute
  l'échantillonnage, le réglage de la tolérance et la relecture des faux positifs. Sur un mur
  chargé, cela peut coûter autant que le placement manuel.
- Le risque porte sur la cotation : `hold_count` en dépend, ADR-068 le fait suivre l'annotation
  et ADR-066 point 5 le fige après le premier passage. Une tache parasite non relevée ne se
  corrige plus.
- La détection ne règle pas la numérotation (traversées, dévers), qui reste manuelle
  (ADR-066 point 2).
- Sans vraies photos, le réglage se ferait à l'aveugle.

**Conséquences :** aucun code à retirer (le lot n'avait rien livré), aucune migration, aucune
préparation à conserver. ADR-066 et ADR-068 restent valables ; leurs renvois au Lot 16 sont
historiques.

**Alternatives écartées :** détection par couleur en spike avec critère go/no-go sur photos
annotées à la main ; segmentation par modèle d'apprentissage (poids du modèle et dépendance
disproportionnés). On pourra rouvrir la question si le placement manuel s'avère trop lent en
conditions réelles.

---

## ADR-070 — La racine `/` est une page d'accueil publique

**Date :** 2026-09-20
**Contexte :** depuis le Lot 1, `/` était un écran vide derrière authentification (« Bonjour,
{nom} » et un bouton « Mes compétitions ») ; un visiteur anonyme était renvoyé sur `/login`.
L'utilisateur a fourni deux maquettes (mobile et desktop, générées par IA, style aquarelle) :
en-tête logo + pilule « Espace organisateur », titre en écriture pinceau, champ de recherche et
bouton « Trouver une compétition », quatre cartes pastel (Organisateurs, Juges, Spectateurs,
Grimpeurs), mur d'escalade sur les côtés, foule en bas. Le dépôt n'avait ni police, ni logo,
ni icône, ni jeton de couleur (`style.css` faisait deux lignes ; la couleur de fait est
`blue-700`).

**Décisions (actées avec l'utilisateur) :**

1. **`/` devient publique et reste la destination après connexion.** La route perd
   `requiresAuth` mais ne prend PAS `skipOrganizerSession` (ADR-053) : la session
   organisateur est restaurée au F5 pour afficher l'en-tête connecté ; si l'API est
   injoignable, la garde avale l'erreur et la page s'affiche en anonyme. L'en-tête a deux
   états : anonyme → pilule « Espace organisateur / Connexion · Inscription » vers `/login` ;
   connecté → nom, lien **« Mes compétitions »** et « Se déconnecter ». Le libellé « Mes
   compétitions » est un contrat : onze tests e2e le cliquent juste après connexion.
   `Login.vue`, `JudgeHome.vue` et la redirection `guestOnly` continuent de viser `home`.
2. **Recherche visible mais désactivée.** La recherche publique est le Lot 13, non engagé
   (préalable RGPD). L'utilisateur a choisi de garder le bloc de la maquette, non
   fonctionnel. Lecture de « rien de simulé » (CLAUDE.md) : champ et bouton `disabled`,
   mention « Recherche bientôt disponible. En attendant, ouvrez le lien ou le QR code… »
   reliée par `aria-describedby`. Jamais un champ qui accepte du texte et ne fait rien.
3. **Cartes.** Organisateurs → `/login` (ou `/competitions` si déjà connecté, sinon la garde
   `guestOnly` ramènerait sur `/`). Juges → « Scannez le QR code remis par l'organisateur » ;
   la carte n'est un lien vers `/j/home` que si un accès juge existe sur l'appareil
   (`judgeToken`). Spectateurs → non-lien : aucune liste publique n'existe avant le Lot 13,
   le texte dit la seule vraie façon d'y accéder (lien ou QR code). Grimpeurs →
   « Inscrivez-vous aux compétitions » avec badge « Bientôt », non cliquable (inscriptions
   en ligne hors périmètre v1, SPEC.md). La flèche `→` n'apparaît que sur les cartes-liens.
4. **Visuels recadrés des maquettes.** Mur et foule sont découpés des deux PNG fournis
   (ImageMagick, WebP, 200 Ko au total, `apps/web/src/assets/landing/`) ; le logo est un SVG
   dessiné à la main proche du badge. Résolution limitée et statut juridique des images IA
   flou : **provisoires**, à remplacer par des visuels HD à licence claire (TODO.md).
5. **Hors précache.** `.webp` et `.woff2` ne sont pas dans `globPatterns` du service worker :
   les visuels et polices de l'accueil ne s'installent jamais sur le téléphone d'un juge ;
   ils passent par le `runtimeCaching` à la demande (`image`/`font`).
6. **Polices auto-hébergées** (`@fontsource/caveat`, graisse 700 bold, pour le titre et le logo,
   `@fontsource/source-sans-3` pour le corps, OFL 1.1), importées dans `Home.vue` donc dans
   le chunk de la page seulement. Pas de CDN : PWA, réseau catastrophique, RGPD.
7. **Jetons de marque limités à l'accueil.** Un bloc `@theme` (`ink`, `navy`, `paper`,
   quatre teintes de cartes, `font-display`, `font-body`) apparaît dans `style.css`, utilisé
   seulement par la landing. Le `Button` partagé, `theme-color`, le manifest et le favicon
   restent sur `blue-700` : on ne re-teinte pas les écrans juge et organisateur validés.
   Les pilules navy sont un composant local (`LandingPill`), pas une variante de
   `packages/ui`.
8. **Menu hamburger de la maquette mobile omis** : aucune navigation à y mettre.
9. **Fonds de cartes en textures aquarelle** (fournies par l'utilisateur : jaune, vert, bleu,
   corail ; WebP 640 px, ~180 Ko au total, `apps/web/src/assets/landing/card-*.webp`).
   La teinte « violet » des maquettes devient « corail » (`tone="coral"`, `--color-card-coral`).
   Un voile blanc de 25 % s'ajoute sous le texte : mesuré sur les cartes recadrées, les coins
   foncés du vert, du bleu et du corail tombaient à 2–3:1 avec l'encre `#0f3241` (AA = 4,5:1) ;
   avec le voile, le bleu et le corail restent ≥ 4,4:1 ; il reste 0,1 % de pixels de coin du
   vert entre 3,3 et 4,1:1 (pas de mesure sous les glyphes eux-mêmes). Comme les autres visuels : hors précache, couleur unie en repli pendant le chargement.

**Conséquences :** `Home.vue` réécrit ; six composants dans
`apps/web/src/components/landing/` ; `router.ts` (route `/` sans `requiresAuth`) ;
`Home.test.ts` et deux tests de plus dans `router.test.ts` ; `e2e/landing.spec.ts` en
desktop et à 360 px ; `index.html` (meta description). Un organisateur connecté qui perd le
réseau et recharge `/` verra l'état anonyme — déjà vrai partout ailleurs (redirection vers
`/login`).

**Alternatives écartées :** rediriger les connectés vers `/competitions` (casse onze specs
e2e et le parcours « je me connecte, j'arrive sur l'accueil » du Lot 1) ; un champ « code
de compétition » ouvrant `/c/<slug>` à la place de la recherche (l'utilisateur préfère le
bloc de la maquette, désactivé) ; engager le Lot 13 maintenant ; rendu CSS seul sans image
raster ; Google Fonts.

---

## ADR-071 — La charte aquarelle de l'accueil s'étend à toute l'application

**Date :** 2026-09-21
**Contexte :** l'ADR-070 (point 7) limitait les jetons de marque à la page d'accueil, le temps
de la valider. L'utilisateur l'a validée et demande que « l'ensemble des pages colle au style
de la landing ». Cinquante fichiers `.vue` portent des utilitaires Tailwind de couleur
(345 `gray-*`, 67 `red-*`, 50 `blue-*`, 32 `amber-*`, 24 `green-*`) ; aucune mise en page
commune n'existe (chaque page a son `<main>`).

**Décisions (actées avec l'utilisateur, 2026-09-21) :**

1. **Écrans juge : couleurs seulement**, sauf la **page d'accès** (`/j/:token`, affichée avec
   du réseau par construction) qui est refaite en profondeur. Aucune image, aucune police
   supplémentaire sur les écrans de notation : rien de plus à précacher, l'ADR-070 points 5
   et 6 restent vrais pour eux.
2. **Organisateur, public, connexion : charte + touches déco.** Source Sans 3, titres de page
   en Caveat, fond papier, en-tête commun avec le logo. Décor aquarelle (mur) seulement sur
   connexion, inscription, accès juge et page publique de compétition ; les écrans de travail
   denses (pilotage, tableaux) restent sobres.
3. **`Button` partagé en pilule partout** (navy plein / contour navy / danger), y compris
   chez les juges : c'est une forme, pas une image, et la cible tactile ≥ 48 px ne change pas.
   `LandingPill` fusionne dans `Button` (prop `to`, variante `glass`).
4. **Couleurs sémantiques harmonisées aussi** (erreur, avertissement, confirmé — statuts de
   synchro compris).

**Mise en œuvre de la couleur :** plutôt que de réécrire 500 classes, les échelles Tailwind
`gray`, `blue`, `red`, `amber` et `green` sont **redéfinies dans `@theme`** (`style.css`) :
neutres teintés encre (teinte 232°), `blue` → navy (`blue-700` = `#184e67`, `blue-800` =
navy-deep, `blue-900` = encre), `red` → corail (30°), `amber` → ocre (78°), `green` → sauge
(148°). Chaque cran garde la clarté OKLCH du cran Tailwind d'origine, donc les contrastes
validés bougent peu ; ils sont néanmoins **mesurés** : `brand-contrast.test.ts` lit
`style.css` et exige AA (4,5:1) pour chaque couple texte/fond réellement utilisé, et 3:1
pour les grands textes et pastilles (bouton TOP du juge : blanc sur `green-600` = 3,8:1,
contre 3,2:1 avec le vert Tailwind d'origine). Trois crans ont été assombris pour passer :
`gray-500`, `green-600`, et toute la moitié sombre de `blue`.

**Conséquences :** `style.css` (échelles + fond papier sur `body`) ;
`brand-contrast.test.ts` ; `packages/ui` : `Button` en pilule avec `to` et `glass`
(`vue-router` devient dépendance pair), champs et cartes en fond blanc sur le papier ;
`LandingPill` supprimé ; `components/brand/` (`BrandShell`, `BrandLogo` déplacé,
`watercolor.ts` partagé avec `RoleCard`) ; `brand-fonts.ts` ; huit pages enveloppées dans
`BrandShell`, titres en Caveat (`text-3xl`, `md:text-4xl`) ; `JudgeAccess.vue` refaite
(panneau aquarelle vert, icône juge, rappel « vous pourrez noter sans réseau », lien
invalide en corail) ; favicon, icônes PWA, `theme-color` `#0e3b4e`, `background_color`
papier, nom « Climb Contest ». Sur mobile le décor de `BrandShell` est un bandeau à hauteur
de l'en-tête : en pleine hauteur, le titre de la page publique passait sur le grimpeur.
L'ADR-070 point 7 est remplacé par cet ADR ; ses points 5 et 6 (hors précache) tiennent
toujours. L'écran de salle reste sombre.

**Régression trouvée et corrigée en route :** le décor de la page d'accès juge (polices +
images) ralentissait le précache du service worker ; `e2e/judge-conflict` (deux appareils
qui passent hors ligne juste après s'être connectés) échouait de façon déterministe —
`Failed to fetch dynamically imported module …/JudgeAscentEntry.js`. La course existait
avant, le décor l'a rendue visible. Correctif : `judge/screens.ts` partage les chargeurs des
écrans juge entre le routeur et `JudgeAccess`, qui les **précharge tous** (en parallèle de
`bootstrapJudge`) avant d'ouvrir `/j/home`. Un juge peut donc perdre le réseau dès la
seconde où il voit ses voies.

**Alternatives écartées :** jetons sémantiques (`brand`, `danger`…) et remplacement classe
par classe — plus propre à la lecture, mais 500 modifications dans des écrans validés pour un
rendu identique (« tu ne réécris pas ce qui marche ») ; Source Sans 3 chez les juges
(~60 Ko de `.woff2` à précacher) ; décor aquarelle dans les écrans organisateur.

---

## ADR-072 — Espace organisateur sur grand écran : seuil `lg`, barre latérale, onglet dans l'URL

**Date :** 2026-09-21
**Contexte :** les pages organisateur sont plafonnées à `max-w-lg` (512 px) ou `max-w-3xl`
(768 px) et n'ont aucun breakpoint `lg:` ; sur un écran de 1440 px plus de la moitié de la
largeur est vide. L'utilisateur précise que la préparation **et le pilotage jour J se font
sur un portable à la table de l'organisation**, le téléphone ne servant que d'appoint.

**Décisions (actées avec l'utilisateur, 2026-09-21) :**

1. **Tout est additif à partir de `lg` (1024 px).** Sous ce seuil le rendu ne change pas ;
   les 360 px restent vérifiés. Écrans juge et public non concernés.
2. **Quatre lots** (ROADMAP Lots 17–20) : socle, tableaux denses, maître–détail, pilotage.
   Un à la fois.
3. **Conteneur unique** : `BrandShell` reçoit `width: 'narrow' | 'wide'`. `wide`
   (`max-w-screen-2xl`) sert aux pages organisateur ; `narrow`, valeur par défaut, garde
   l'en-tête `max-w-6xl` des pages d'entrée et publiques.
4. **Barre latérale groupée** sur la page compétition à partir de `lg` : *Préparer* (Infos,
   Catégories, Compétiteurs, Voies, Tours, Juges), *Vérifier* (Prêt à démarrer ?), *Jour J*
   (Pilotage, Exports). C'est le même composant `Tabs`, en `orientation="vertical"` : on
   garde `role="tab"` et les mêmes libellés, donc la sémantique, la navigation au clavier et
   les 28 sélecteurs `getByRole('tab')` des e2e.
5. **L'onglet vit dans l'URL** : `/competitions/:id/:tab?`, et `?section=` pour les
   sous-sections du pilotage. Rechargement, lien profond, « précédent » du navigateur et
   plusieurs fenêtres côte à côte fonctionnent. Un onglet inconnu, ou `rounds` sur une
   compétition sans phases, retombe sur `infos`.
6. **Le pilotage sur portable devient la cible d'optimisation** (Lot 20) ; son rendu mobile
   reste fonctionnel.

**Mise en œuvre (Lot 17) :** `BrandShell` en `wide` coupe le débordement avec
`overflow-x-clip` et non `overflow-x-hidden` — `hidden` fait de la coque un conteneur de
défilement, et ni l'en-tête ni la barre latérale n'y seraient collants. L'en-tête de
compétition n'est collant qu'à partir de `lg` (sur un téléphone il mangerait la hauteur
utile). Le lien retour garde son libellé « ← Mes compétitions » à toutes les largeurs : un fil
d'Ariane à deux niveaux n'apporte rien de plus, et deux parcours e2e le ciblent par ce nom.
L'orientation de `Tabs` suit `useMediaQuery('(min-width: 1024px)')` : un seul `tablist` dans
le DOM, jamais deux dont un masqué en CSS. La liste des onglets et la résolution du segment
d'URL sont des fonctions pures (`lib/competition-tabs.ts`).

**Alternatives écartées :** onglets horizontaux simplement élargis (neuf libellés à plat,
sans hiérarchie, et toujours pas de place pour des pastilles d'alerte) ; une barre latérale
en `<nav>` de liens (sémantique défendable, mais réécriture de 28 sélecteurs e2e pour un
gain nul à l'usage) ; routes enfants une par onglet (refonte de `CompetitionDetail` sans
bénéfice par rapport à un paramètre).

---

## ADR-073 — Densité compacte à la souris seulement

**Date :** 2026-09-21
**Contexte :** `CLAUDE.md` impose des cibles tactiles ≥ 48 px. Dans un tableau de 150
compétiteurs sur un écran 1080p, cela donne une douzaine de lignes visibles contre dix-huit
à 40 px.

**Décision (actée avec l'utilisateur) :** les lignes de tableau et actions compactes
(~40 px) sont autorisées **uniquement sous `@media (pointer: fine)`**, dans l'espace
organisateur. Tout appareil tactile — tablette comprise, quelle que soit sa largeur —
garde 48 px. C'est une dérogation explicite à `CLAUDE.md` § « Conséquences non
négociables », point 4 ; elle ne s'applique à aucun écran juge. Mise en œuvre au Lot 18 ;
le Lot 17 ne réduit aucune cible.

**Alternative écartée :** 48 px partout — règle plus simple, mais un tiers de lignes en
moins sur l'écran où l'organisateur passe le plus de temps.

**Amendé au Lot 18 :** la requête retenue est
`(pointer: fine) and (not (any-pointer: coarse))`. Un portable à écran tactile rapporte
`pointer: fine` pour son pavé tactile alors que le doigt y reste possible ; `pointer: fine`
seul l'aurait compacté, contre la lettre même de cette décision. Voir ADR-074.

---

## ADR-074 — `DataList` : une définition de colonnes, deux rendus

**Date :** 2026-09-21
**Contexte :** Lot 18. Les six listes de l'espace organisateur (compétiteurs, voies, juges,
catégories, liste des compétitions, corbeille) étaient des `<ul>` de cartes plafonnées à
768 px, alors que le Lot 17 venait de leur donner toute la largeur de l'écran (ADR-072).

**Décisions :**

1. **Une colonne se décrit une seule fois** (`DataListColumn<Row>` : clé, libellé, valeur,
   comparateur, rôle en carte) et sert aux deux rendus. Un slot scopé `cell-<clé>` prend la
   main dès qu'il faut autre chose que du texte. C'est le premier composant générique du
   projet (`<script setup generic="Row">`) ; le monter en test exige l'expression
   d'instanciation TS 4.7 (`mount(DataList<Row>, …)`), sans quoi le générique retombe sur
   sa contrainte.

2. **Un seul arbre dans le DOM.** C'est l'appelant qui choisit `layout` à partir de
   `useMediaQuery`, jamais un `hidden lg:table`. Même raison que le `tablist` unique
   d'ADR-072 : deux rendus dont un masqué en CSS, ce sont deux arbres d'accessibilité et
   des boutons d'action en double, que les sélecteurs e2e atteignent au hasard.

3. **Le tri est piloté.** `DataList` ne réordonne jamais ses lignes : il émet `update:sort`
   et l'appelant trie. La liste des compétitions garde ainsi son tri dans l'adresse
   (ADR-062) et les en-têtes remplacent son sélecteur « Trier par » au-dessus de 1024 px —
   deux commandes pour une même chose finissent par diverger. Dans les quatre onglets, le
   tri vit dans un `ref` local : on ne partage pas un lien vers « les juges triés par
   dernier accès ».

4. **Voies et catégories ne sont pas triables.** Leur ordre est celui que l'organisateur a
   posé aux flèches ; un tri masquerait ce que les flèches viennent de faire.

5. **Deux façons de faire une carte, assumées.** Les quatre onglets composent la leur à
   partir des rôles (`title`, `subtitle`, `aside`, `actions`). La liste et la corbeille
   passent par un slot `card` d'échappement qui reprend leur markup au mot près : leur
   carte enveloppe un lien ou une case à cocher, ce qu'une composition ne sait pas
   reproduire, et le rendu à 360 px ne doit pas bouger.

6. **Densité.** La variante Tailwind `fine:` (ADR-073 amendé) ne compacte que le tableau :
   cellules, cases à cocher et actions de ligne. `Button.vue` ne reçoit **aucune** variante
   de taille — la lui donner rendrait compacte la pilule de 48 px jusque sur les écrans
   juge. Les actions de ligne sont donc des `<button>` nus, pas des `Button`.

7. **Colonnes facultatives à 1280 px.** Le tableau des compétiteurs ne sort l'année de
   naissance, le club et le numéro de licence qu'au-delà de `xl`. Vérifié en navigateur :
   ses neuf colonnes à 1024 px réduisent chaque nom à une vingtaine de pixels.

8. **Le numéro de licence est affiché** (décision de l'utilisateur, prise en connaissance
   de cause). C'est la donnée la plus sensible du modèle, bannie de la vue publique ;
   l'écran est derrière l'authentification organisateur, mais un tableau se projette et se
   photographie.

9. **En-tête collant, trois pièges.** Le `sticky` porte sur chaque `<th>` et non sur
   `<thead>` (support plus large), sa bordure est une ombre interne (sous
   `border-collapse`, la bordure d'une cellule collée disparaît), et il ne doit jamais
   exister de conteneur `overflow-x-auto` autour du tableau — il deviendrait un conteneur
   de défilement et l'en-tête ne collerait plus jamais. Le décalage vient de
   `--datalist-top`, posée une seule fois par `CompetitionDetail`.

10. **Nom accessible des champs d'ajout rapide.** Ils désignent le libellé de la colonne et
    non son `<th>` : le glyphe de tri vit dans le même bouton et entrait dans le nom
    (« Catégorie↕ »). Défaut vu en navigateur, verrouillé par un test.

**Alternatives écartées :** un rendu carte entièrement généré à partir des colonnes (il
réécrirait le mobile de la corbeille et de la liste pour un gain invisible) ; deux slots
séparés carte/tableau (le contenu diverge fatalement) ; `hidden lg:table` (point 2) ;
rendre la ligne entière cliquable (ni rôle, ni focus, ni clavier, et la sélection de texte
cassée — le lien vit dans l'en-tête de ligne) ; une case « tout cocher » en en-tête (les
deux écrans concernés ont déjà un bouton « Tout sélectionner »).

---

## ADR-075 — Maître–détail des voies et des juges : la sélection vit dans l'adresse

**Date :** 2026-09-21
**Contexte :** Lot 19 (D3 de la série desktop). Après le Lot 18, `RoutesTab` et `JudgesTab`
empilent un tableau pleine largeur puis un formulaire **en dessous**. Sur un portable de
1440 px, modifier la voie 7 veut dire perdre la liste des yeux, et la moitié droite de l'écran
reste vide pendant toute la préparation.

**Décisions :**

1. **Grille à deux colonnes à partir de 1440 px, et non de `lg`.** Le cadrage disait 1024 px ;
   la mesure en navigateur dit non. Les largeurs fixes du tableau des voies totalisent **656 px**
   (528 px pour celui des juges) ; avec la barre latérale de 15 rem et un panneau de 24 rem, la
   liste ne retrouve ces 656 px qu'à **1440 px**. En dessous, le tableau déborde sa colonne et
   passe **sous** le panneau collant, qui intercepte alors les clics — défaut trouvé par le test
   e2e, invisible autrement puisque `BrandShell` coupe le débordement (`overflow-x-clip`) et
   qu'aucun défilement horizontal n'apparaît. Le seuil est donc `min-[1440px]:`, apparié à
   `MASTER_DETAIL_QUERY`. Entre 1024 et 1440 px, les deux onglets gardent exactement le rendu du
   Lot 18 : tableau, actions sur la ligne, éditeur en dessous.
   La grille elle-même est en classes responsives pures sur un seul arbre. Ce n'est pas une
   entorse à ADR-074 point 2 : celui-ci interdit **deux copies du même contenu** dont une
   masquée, pas les classes responsives — la page compétition en pose déjà (`hidden lg:inline`
   sur la date et le lien public). `useMediaQuery` reste requis là où le **comportement**
   diffère, pas la mise en page.
2. **`minmax(0,1fr)` sur la colonne de gauche, pas `1fr`.** Sans lui, le `table-fixed` de
   `DataList` élargit la piste de grille au lieu de tenir dedans.
3. **Pas de conteneur de défilement autour du panneau.** La colonne de droite est
   `lg:sticky lg:top-24` sans `overflow-y-auto` : un conteneur de défilement décrocherait
   l'en-tête collant du tableau (ADR-074 point 9), et le panneau contient une photo dont on veut
   la hauteur naturelle. Un panneau plus haut que l'écran défile avec la page ; c'est
   l'annotateur plein écran (ADR-077) qui règle le cas de la grande photo.
4. **La sélection vit dans l'adresse** : `?route=<id>`, `?judge=<id>`, sur le patron `?section=`
   du pilotage (ADR-072 point 5) — dans l'onglet, pas dans le routeur. Recharger la page en
   pleine annotation ne referme pas la voie. Écriture par `router.replace` et non `push` : une
   entrée d'historique par ligne cliquée ferait du bouton « précédent » un désélecteur au lieu
   d'un retour. Un id inconnu retombe silencieusement sur « aucune sélection », le reste de la
   query préservé. C'est un écart assumé à la note du Lot 18 (« recherche et filtre des onglets
   ne sont pas dans l'adresse ») : une sélection ouvre un panneau d'édition, un filtre non.
5. **Changer de sélection est refusé tant qu'une création est en reprise** (`created !== null`,
   ADR-067 point 5 / ADR-068 point 4 : une voie créée dont la photo ou les prises ne sont pas
   parties). Auparavant, « Modifier » écrasait cet état sans rien dire ; avec une liste cliquable
   en permanence à côté du panneau, ce clic devient facile et fait perdre la reprise.
6. **Chez les juges, les trois actions quittent la ligne dès qu'une fiche existe** (« Voir l'accès »,
   « Régénérer le PIN », « Révoquer ») et vivent dans la fiche ; la ligne ne garde que
   l'ouverture. Les laisser aux deux endroits, ce sont exactement « des boutons d'action en
   double, que les sélecteurs e2e atteignent au hasard » qu'ADR-074 point 2 interdit. En dessous
   de 1440 px — donc aussi dans la bande où il y a un tableau mais pas de fiche — rien ne bouge.
7. **Les modales qui avertissent restent des modales, à toutes les largeurs** : l'accès révélé après
   création et le PIN régénéré sont des « à noter maintenant » (ADR-026), ils doivent bloquer.
   Seule « Voir l'accès », qui est de la consultation, est remplacée par la fiche au-dessus de
   1440 px.
8. **Le panneau garde un mode unique création/édition.** Afficher « Ajouter une voie » et
   l'édition en même temps donnerait deux formulaires côte à côte, alors que la séquence
   reprenable d'ADR-068 point 4 suppose un seul brouillon vivant.

**Limites connues :** les modifications non enregistrées ne survivent pas au rechargement — la
voie se rouvre, ses valeurs sont relues du serveur (`RouteEditorPanel` n'a pas de
`useFormDraft`, contrairement à `InfosTab` et `CompetitionCreate`). Un portable de 1366 px de
large n'a donc pas le maître–détail : c'est le prix de colonnes de tableau à largeur fixe
(`table-fixed`, ADR-074), pas une limite de principe.

**Alternatives écartées :** un composant `MasterDetail` dans `packages/ui` (deux usages et six
classes ; `ListToolbar` a déjà tranché que le seuil de 1024 px est une décision de
l'application, pas du composant) ; la sélection en état local (plus simple, mais un rechargement
accidentel referme le panneau, ce que `CLAUDE.md` proscrit) ; rendre la ligne entière cliquable
(écarté par ADR-074) ; un panneau latéral glissant comme chez le juge (la liste doit rester
visible, c'est tout l'intérêt).

---

## ADR-076 — Le QR code du juge est généré dans le navigateur

**Date :** 2026-09-21
**Contexte :** Lot 19, fiche juge. Jusqu'ici le QR n'existe que côté serveur, dans la planche
PDF (`apps/api/src/lib/qrcode-pdf.ts`) ; la dépendance `qrcode` n'est déclarée que par
`apps/api` et aucun écran web n'affiche de QR. L'organisateur qui veut faire scanner un juge
doit imprimer la planche.

**Décision (actée avec l'utilisateur) :** `qrcode` devient aussi une dépendance de `apps/web`
(même version épinglée, `1.5.4`), et la fiche rend un **SVG** produit dans le navigateur à
partir du lien d'accès.

**La raison décisive n'est pas le confort, c'est un cas que le serveur ne sait pas traiter.**
Quand `judgeCredentialsStored` est désactivé (ADR-027), le serveur ne conserve **aucun** clair :
le jeton n'existe qu'une seule fois, dans la réponse de création, et vit ensuite dans la mémoire
du navigateur (`revealedJudgeTokens`). Un point d'API `.../qrcode.svg` serait donc incapable de
dessiner le QR précisément du juge qu'on vient de créer — le moment où on en a le plus besoin.

**Conséquences :**

- Le jeton d'accès ne transite jamais dans une URL d'image : ni journal d'accès, ni `Referer`,
  ni cache de proxy.
- Le SVG est injecté en `v-html`. C'est acceptable **parce que la chaîne vient de la
  bibliothèque**, pas d'une saisie ; le commentaire du composant le dit, sans quoi c'est une
  alerte de revue de sécurité légitime.
- Aucun QR n'est rendu pour un juge révoqué, ni quand ni le clair stocké ni un jeton de session
  ne sont disponibles : la fiche dit quoi faire à la place.
- Deux implémentations de QR coexistent dans le dépôt (le PDF garde la sienne). Assumé : elles
  ne partagent ni le support ni les contraintes.
- Le PIN ne s'affiche jamais **dans** le QR, comme il ne s'imprime pas sur la planche (ADR-026).

**Alternatives écartées :** un point d'API image (ne couvre pas le cas ci-dessus, ajoute une
route, un contrat et des tests de sécurité pour un secret qui transiterait en image) ; pas de QR
à l'écran (la planche PDF reste le seul support, mais le libellé du lot demande la fiche).

---

## ADR-077 — Zoom et plein écran dans l'annotateur, à toutes les largeurs

**Date :** 2026-09-21
**Contexte :** ADR-068 listait en limite connue que « les prises se placent sur un aperçu de
640 px de côté long, sans zoom : à vérifier sur un mur chargé ». Sur une voie de quarante prises
serrées, le placement est approximatif. La série des Lots 17–20 pose par ailleurs que tout est
**additif à partir de `lg`** et que le rendu mobile ne change pas (ADR-072 point 1).

**Décision (actée avec l'utilisateur) :** le zoom ×1/×2/×3 et le mode plein écran de
l'annotateur sont disponibles **à toutes les largeurs, mobile compris**. C'est un écart assumé
à ADR-072 point 1 : ce n'est pas de la mise en page pour grand écran, c'est la correction d'un
défaut de saisie documenté, et l'organisateur qui annote devant le mur est justement celui qui
a un téléphone en main.

**Conséquences :**

1. **L'aperçu de création passe de 640 px à 1280 px** (qualité 0,7 → 0,8). Sans cela, le ×3 est
   flou. Sans effet sur la correction : les prises sont en coordonnées normalisées (ADR-066
   point 4) et la photo envoyée est ré-encodée depuis le **fichier d'origine**, pas depuis
   l'aperçu. Effet réel : `resizeToJpeg` est synchrone sur le thread principal et traite quatre
   fois plus de pixels — c'est le seul point du lot où « le rendu mobile ne change pas » peut
   être enfreint sans qu'aucun test ne le voie, donc il se mesure sur un téléphone.
2. **Le cadre zoomable devient un composable partagé** (`useZoomableFrame`), extrait du dialogue
   de recadrage qui l'avait déjà écrit : largeur de base qui fait tenir la photo entière à ×1,
   recentrage du défilement autour du milieu de l'écran au changement de niveau.
3. **L'écran juge n'est pas converti.** `RoutePhotoPanel` porte la troisième copie du même zoom ;
   le gain serait cosmétique et `CLAUDE.md` déclare les écrans juge non négociables. Noté dans
   `TODO.md`.
4. Le dialogue plein écran restitue le focus à son ouvrant, comme le dialogue de recadrage.
   `Modal` de `packages/ui` ne le fait toujours pas : troisième implémentation maison du même
   besoin, notée dans `TODO.md`.

**Alternatives écartées :** réserver le zoom à `lg` (respecte la lettre de la série, mais laisse
la limite d'ADR-068 ouverte exactement là où elle gêne) ; monter l'aperçu à 1600 px, la taille
de la photo stockée (le coût de ré-encodage sur téléphone n'est pas justifié par le gain à ×3) ;
un second aperçu haute résolution calculé à l'ouverture du dialogue seulement (plus économe,
mais deux aperçus à garder cohérents et un garde anti-course de plus).

---

## Points encore ouverts (non tranchés dans ce Lot 0)

- ~~**RGPD — durée de conservation et de purge**~~ Tranché au Lot 9,
  ADR-051 (export et purge manuels, avec rappel à 2 et 5 ans).
