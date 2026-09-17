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

## Points encore ouverts (non tranchés dans ce Lot 0)

- **RGPD — durée de conservation et de purge** (SPEC.md §8.8) : la
  proposition (archivage 2 ans, purge 5 ans) n'a pas été validée avec le
  club. À trancher avant le Lot 9, qui implémente l'export/purge.
