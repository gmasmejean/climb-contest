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
modèle athlétisme (DNS = *did not start*, DNF = *did not finish*) :
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

## Points encore ouverts (non tranchés dans ce Lot 0)

- **RGPD — durée de conservation et de purge** (SPEC.md §8.8) : la
  proposition (archivage 2 ans, purge 5 ans) n'a pas été validée avec le
  club. À trancher avant le Lot 9, qui implémente l'export/purge.
