# ROADMAP.md — lots de livraison

Neuf lots. **Un seul à la fois.** Chaque lot est une session Claude Code
autonome, dont le prompt est donné tel quel ci-dessous. Un lot n'est pas fini
tant que les six critères de `CLAUDE.md` § « Définition de terminé » ne sont pas
vrais.

Entre deux lots : tu essaies la fonctionnalité toi-même, tu notes ce qui cloche,
et tu ouvres la session suivante en corrigeant d'abord.

| Lot | Contenu | Livrable vérifiable |
|---|---|---|
| 0 | Plan et décisions | `DECISIONS.md` rempli, `SPEC.md` à jour |
| 1 | Socle technique | `docker compose up` démarre, tests verts, CI verte |
| 2 | Moteur de cotation | 24 cas de test de `SPEC.md` § 9 au vert |
| 3 | Espace organisateur — préparation | Créer une compétition complète de bout en bout |
| 4 | Juges, QR codes, accès | Scanner un QR, saisir un PIN, arriver sur ses voies |
| 5 | Interface juge en ligne | Noter un passage depuis un téléphone |
| 6 | Hors ligne et synchronisation | Mode avion → saisies → reconnexion → tout est là |
| 7 | Public et temps réel | Classement qui bouge sur un deuxième appareil |
| 8 | Pilotage jour J | Tableau de bord, corrections, conflits |
| 9 | Phases, exports, durcissement | Une finale complète, résultats en PDF |

---

## Lot 1 — Socle technique

> Tu as choisi de commencer par le socle plutôt que par une tranche verticale.
> C'est le bon choix sur un projet où la correction des calculs et la fiabilité
> hors ligne comptent plus que la démo rapide — mais ça veut dire que tu ne
> verras rien de visible avant le Lot 3. Tiens bon.

```
Lot 1 : le socle technique. Aucune fonctionnalité métier dans ce lot.

Objectif : que je puisse cloner le dépôt, lancer une commande, et avoir une
application qui tourne, une base migrée, des tests verts et une CI verte. Rien
de plus, rien de moins.

Périmètre :

1. Monorepo pnpm + Turborepo, selon l'arborescence de SPEC.md § 6.2, avec les
   paquets vides mais correctement câblés (imports croisés fonctionnels,
   typecheck qui traverse les frontières de paquets).

2. TypeScript strict partout : `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`. ESLint + Prettier, une seule configuration
   partagée à la racine.

3. `packages/db` : le schéma Drizzle complet de SPEC.md § 5, la première
   migration, et un script de seed produisant une compétition d'exemple
   réaliste — deux catégories, une douzaine de compétiteurs, quatre voies, deux
   juges. Les migrations sont réversibles et tu vérifies le down.

4. `packages/contracts` : les schémas Zod des entités et des payloads d'API, et
   les types dérivés. Zéro type écrit deux fois.

5. `apps/api` : Hono qui démarre, avec `/health`, la connexion Postgres,
   la gestion d'erreurs au format RFC 9457, les logs structurés, le CORS, et la
   limitation de débit. Aucune route métier.

6. Authentification organisateur complète et testée : inscription (réservée au
   premier utilisateur ou par invitation — dis-moi ce que tu recommandes),
   connexion, refresh rotatif avec détection de réutilisation, déconnexion,
   argon2id. C'est de la sécurité : je veux des tests, y compris des tests de
   l'attaque par réutilisation de refresh token.

7. `apps/web` : Vue 3 + Vite + TypeScript, routeur, TanStack Query, Tailwind,
   `vite-plugin-pwa` configuré (manifeste, icônes, precache), et exactement
   deux écrans : connexion et une page d'accueil vide derrière l'authentification.

8. `packages/ui` : les primitives dont le reste du projet dépendra — bouton,
   champ, sélecteur, modale, toast, indicateur de synchronisation. Cibles ≥ 48 px,
   contraste AA, testées à 360 px. Pas de librairie de composants tierce.

9. Tests : Vitest configuré sur tous les paquets, Playwright configuré avec un
   seul test e2e (je me connecte, j'arrive sur l'accueil). Une base de test
   éphémère (testcontainers ou une base dédiée, à toi de voir).

10. `infra/docker` : Dockerfile multi-étapes pour l'API, compose avec Postgres
    et Caddy, variables d'environnement documentées dans `.env.example`.

11. CI GitHub Actions : install, typecheck, lint, test, build. Verte.

12. `README.md` : démarrage en moins de cinq commandes, et elles marchent —
    tu les exécutes pour vérifier.

Contraintes :
- Aucune route métier, aucun écran métier. Si tu es tenté d'ajouter « juste la
  création de compétition », note-le dans TODO.md et arrête-toi.
- Épingle les versions. Pas de `^` sur les dépendances critiques.
- À la fin, lance toutes les commandes du README depuis zéro et montre-moi la
  sortie.

Commence par me présenter ton plan d'exécution en étapes numérotées, et
attends mon feu vert avant d'écrire la première ligne.
```

---

## Lot 2 — Le moteur de cotation

C'est le lot le plus important du projet. Il est petit, isolé, et entièrement
testable sans interface. Fais-le tôt, fais-le bien.

```
Lot 2 : packages/scoring — le moteur de cotation et de classement.

Ce paquet ne dépend de rien : ni base, ni réseau, ni framework. Des types, des
fonctions pures, et beaucoup de tests.

1. Les types du domaine : Ascent, Route, ScoreValue, RouteRanking, RoundRanking,
   FinalRanking, et les contextes associés.

2. L'interface ScoringEngine de SPEC.md § 4.6, et un registre de moteurs.

3. Une seule implémentation : `ffme-difficulty-2026`, suivant SPEC.md § 4.
   - notation d'un passage (§ 4.1)
   - classement sur une voie, avec la cascade de départages (§ 4.2)
   - classement d'un tour, moyenne géométrique des rangs (§ 4.3)
   - format phases : qualifiés, classement final, contre-performance (§ 4.4)
   - format contest : somme des M meilleures (§ 4.5)

4. Les 24 cas de test de SPEC.md § 9, repris littéralement, chacun nommé
   d'après son numéro. Plus les tiens : je veux au minimum du test par propriété
   sur la fonction de classement (le classement est déterministe ; deux
   compétiteurs aux performances identiques ont le même rang ; la somme des
   ex aequo ne décale pas le total).

5. Un fichier `packages/scoring/RULES.md` qui explique chaque règle en français,
   en prose, avec un exemple chiffré. Ce document doit être lisible par un juge
   fédéral qui ne sait pas programmer — c'est avec lui que je ferai valider les
   règles.

Points de vigilance :
- La moyenne géométrique n'est PAS une moyenne arithmétique. Le cas de test 11
  est là pour ça.
- Les ex aequo décalent le rang suivant (1, 2, 2, 4), jamais (1, 2, 2, 3).
- L'arithmétique flottante : √(1×4) doit être exactement égal à √(2×2) dans ta
  comparaison. Décide d'une stratégie (arrondi à 6 décimales, ou comparaison par
  produit des rangs plutôt que par racine) et documente-la.
- Aucun accès base, aucun `Date.now()`, aucune dépendance au fuseau horaire.

Couverture attendue sur ce paquet : 100 % des branches. C'est le seul endroit du
projet où je l'exige.
```

---

## Lot 3 — Espace organisateur : préparation

```
Lot 3 : l'espace organisateur, partie préparation de la compétition.

À la fin de ce lot, je dois pouvoir préparer entièrement une compétition réelle
depuis mon navigateur, sans passer par la base.

1. Compétitions : liste, création (nom, lieu, dates, format contest ou phases,
   moteur de cotation), édition, changement de statut.

2. Catégories : création depuis un modèle FFME prédéfini (U12 à Vétéran ×
   Homme/Femme) ou en libre, réordonnancement, édition, suppression avec
   protection si des compétiteurs y sont rattachés.

3. Compétiteurs :
   - saisie unitaire, rapide au clavier (le formulaire se réinitialise et
     garde le focus, on en saisit trente à la suite sans toucher la souris) ;
   - import CSV avec prévisualisation obligatoire : le fichier est analysé, les
     erreurs listées ligne par ligne, les doublons détectés, et RIEN n'est écrit
     tant que je n'ai pas validé ;
   - attribution des dossards, manuelle ou automatique par catégorie ;
   - recherche, filtre par catégorie, édition, retrait.

4. Voies : création, numéro, nom, nombre de prises, secteur, couleur,
   affectation à une ou plusieurs catégories, vidéo (lien externe ; le
   téléversement viendra plus tard), réordonnancement.

5. Tours, pour le format phases : création, type, style, ordre, voies par
   catégorie, nombre de qualifiés.

6. Une page de contrôle « prêt à démarrer ? » qui liste ce qui manque avant
   d'ouvrir la compétition : catégorie sans voie, voie sans catégorie,
   compétiteur sans dossard, voie sans juge assigné, tour sans voie. C'est
   l'écran que je regarderai la veille au soir — soigne-le.

Ergonomie : c'est de la saisie en masse, sur un ordinateur, souvent tard le
soir avant la compétition. Optimise pour la vitesse au clavier, l'annulation
facile, et l'absence de perte de données sur un rechargement accidentel
(brouillon local des formulaires longs).
```

---

## Lot 4 — Juges, QR codes et accès

```
Lot 4 : la création des juges, leurs accès et les QR codes.

1. Gestion des juges par l'organisateur : création (nom d'affichage),
   assignation à une ou plusieurs voies, révocation, régénération du PIN.

2. Génération à la création : un token d'accès aléatoire (32 octets, base62) et
   un PIN à 6 chiffres. Les deux ne sont affichés en clair QU'UNE SEULE FOIS,
   dans un encart explicite. En base, seuls les hachés argon2id.

3. Le flux d'accès juge :
   - `/j/<token>` → écran « Bonjour <nom>, saisissez votre code » ;
   - PIN à 6 chiffres, pavé numérique large ;
   - 5 tentatives, puis blocage 15 minutes, avec compteur visible ;
   - limitation de débit côté serveur, par juge et par IP ;
   - succès → JWT juge de portée restreinte (compétition + voies assignées),
     stocké de manière persistante sur l'appareil, valable jusqu'à la fin de la
     compétition + 12 h.
   - Un juge révoqué est déconnecté au prochain appel, avec un message clair.

4. Planche de QR codes imprimable, en PDF, A4 :
   - un QR par juge, avec son nom, ses voies, et un emplacement pour écrire le
     PIN à la main (le PIN ne s'imprime PAS sur la planche) ;
   - le QR d'accès public, en grand, sur une page séparée destinée à être
     affichée dans la salle.
   - Génération côté serveur, pas de dépendance à un service externe.

5. Tests de sécurité obligatoires : token invalide, token révoqué, PIN faux,
   blocage après 5 essais, JWT juge utilisé sur une voie non assignée, JWT juge
   utilisé sur une autre compétition. Chacun doit échouer proprement.

Écris dans DECISIONS.md ce qui se passe si l'organisateur perd le PIN d'un juge
au milieu de la compétition.
```

---

## Lot 5 — Interface juge (en ligne)

```
Lot 5 : l'interface de saisie du juge, en mode connecté uniquement.
Le hors ligne arrive au lot suivant — ne l'anticipe pas, mais ne t'interdis pas
une structure qui l'accueillera (mutations passant par une seule fonction, état
de synchronisation déjà présent dans le modèle d'interface).

1. Écran d'accueil juge : ses voies, et rien d'autre. Pour chaque voie : numéro,
   nom, nombre de prises, catégories, et l'avancement (x passages sur y attendus).

2. Écran d'une voie : la liste des compétiteurs concernés, séparée en « à faire »
   et « fait », recherche par dossard ou par nom, gros boutons.

3. Écran de saisie d'un passage :
   - le compétiteur en grand (dossard, nom, catégorie) ;
   - un pavé numérique pour le numéro de prise, borné à [1, hold_count] ;
   - deux boutons de modificateur : neutre / `+` (ADR-001, `n−` abandonné) ;
   - un bouton `TOP` pleine largeur, visuellement distinct ;
   - les statuts `chute` (défaut), `DNS`, `DNF` ;
   - un champ chrono, seulement si la compétition l'a activé ;
   - un récapitulatif avant validation, en toutes lettres :
     « Dossard 47 — Léa Martin — Voie 3 — prise 25+ ». Le juge confirme.

4. Après validation : confirmation visuelle nette, retour à la liste, le
   compétiteur passe dans « fait », et un indicateur d'état de synchronisation
   apparaît sur la ligne.

5. Correction de la dernière saisie, dans la fenêtre décidée au lot 0.

6. Ergonomie terrain, non négociable : tout est utilisable à une main, en
   portrait, sur un écran de 360 px. Aucune action critique derrière un geste.
   Retour haptique à la validation. L'écran ne se verrouille pas pendant la
   saisie (Wake Lock API, avec repli silencieux si indisponible).

7. Un test Playwright du parcours complet, en émulation mobile.
```

---

## Lot 6 — Hors ligne et synchronisation

> Le lot le plus difficile. Prends ton temps, et teste-le pour de vrai, en mode
> avion, sur un vrai téléphone.

```
Lot 6 : le fonctionnement hors ligne de l'interface juge.

Implémente la stratégie décrite dans SPEC.md § 6.3, dans son intégralité.

1. `GET /judge/bootstrap` : un appel unique qui renvoie tout ce dont le juge a
   besoin pour la journée. Persisté dans IndexedDB via Dexie.

2. Service worker : precache de la coquille applicative, stratégie
   network-first avec repli cache pour les données, cache-first pour les
   ressources statiques. Une nouvelle version ne s'installe JAMAIS pendant
   qu'une saisie est en attente.

3. File de synchronisation :
   - chaque saisie génère un UUID v7 côté client et est écrite en IndexedDB
     AVANT toute tentative réseau ;
   - mise à jour optimiste immédiate de l'interface ;
   - envoi par lots sur `POST /judge/ascents/batch`, avec repli exponentiel
     plafonné et jitter ;
   - reprise automatique au retour du réseau (`online`), au retour au premier
     plan (`visibilitychange`) et au démarrage de l'application ;
   - la file survit à la fermeture de l'onglet et au redémarrage du téléphone.

4. Le serveur traite le lot de manière idempotente et répond par un état par
   élément : `accepted`, `duplicate`, `conflict`, `rejected` (avec motif).
   Un élément `rejected` n'est jamais silencieusement abandonné côté client.

5. Conflits : deux appareils ont saisi le même (tour, voie, compétiteur) avec
   des valeurs différentes. Les DEUX sont conservés en base, liés par un
   `conflict_group`. Le juge voit un avertissement, l'organisateur reçoit une
   alerte et tranchera au lot 8. Aucune donnée n'est perdue, jamais.

6. Interface : un bandeau d'état permanent et honnête — « Hors ligne, 4 saisies
   en attente » / « Synchronisation… » / « À jour ». Le juge doit pouvoir faire
   confiance à cet indicateur sans le comprendre.

7. Tests, et je serai exigeant là-dessus :
   - les cas 21 à 24 de SPEC.md § 9 ;
   - un test Playwright qui coupe le réseau, saisit 10 passages, recharge la
     page, le rétablit, et vérifie que les 10 sont arrivés dans le bon ordre ;
   - un test de conflit entre deux contextes de navigateur ;
   - un test de quota IndexedDB plein.

Avant d'écrire du code, explique-moi ta stratégie de réconciliation en une page,
avec le diagramme des états d'un élément de la file. Je veux la valider d'abord.
```

---

## Lot 7 — Public et temps réel

```
Lot 7 : l'interface publique et la diffusion temps réel.

1. `/c/<slug>` : page publique, sans authentification, mobile-first.
   - sélecteur de catégorie, mémorisé localement ;
   - le classement de la catégorie : rang, dossard, nom, club, et le détail par
     voie (dépliable) ;
   - marquage explicite « provisoire » tant que le tour n'est pas publié ;
   - la liste des voies : numéro, nom, nombre de prises, secteur, et la vidéo
     d'enchaînement (lecteur intégré pour YouTube/Vimeo) ;
   - pour le format phases : l'état de chaque tour.

2. Temps réel par SSE : `GET /public/:slug/stream`, événements
   `ranking_updated`, `round_status_changed`, `route_updated`. Reconnexion
   automatique, repli en sondage toutes les 30 s si SSE échoue, et affichage
   discret de la dernière mise à jour reçue.

3. Performance : le classement est recalculé côté serveur et mis en cache,
   invalidé à chaque passage. Cible : 300 spectateurs connectés simultanément
   sur un serveur modeste. Mesure-le avec un test de charge simple et donne-moi
   les chiffres.

4. Données personnelles : le public voit nom, prénom, club, dossard. Rien
   d'autre. Pas de date de naissance, pas de licence.

5. Page « écran de salle » : une vue plein écran, gros caractères, lisible à
   dix mètres, qui fait défiler le classement de chaque catégorie en boucle.
   C'est ce qu'on branchera sur le vidéoprojecteur.
```

---

## Lot 8 — Pilotage jour J

```
Lot 8 : le tableau de bord de l'organisateur pendant la compétition.

1. Vue d'ensemble temps réel :
   - avancement par catégorie et par voie ;
   - compétiteurs n'ayant pas encore grimpé, et voies restantes par compétiteur ;
   - juges : dernier signe de vie, nombre de saisies, état de synchronisation ;
   - alertes : voie sans saisie depuis 15 minutes, juge muet depuis 10 minutes,
     conflit non résolu, compétiteur sans aucun passage alors que le tour se
     termine.

2. Correction d'un passage : l'organisateur peut modifier n'importe quel
   passage. Motif obligatoire. L'ancien est chaîné, pas écrasé. L'historique
   complet est consultable par passage.

3. Résolution de conflit : les deux valeurs côte à côte, avec le juge, l'appareil
   et l'heure de chacune. L'organisateur choisit, ou saisit une troisième valeur.
   La décision est tracée.

4. Saisie de secours : l'organisateur peut saisir un passage à la place d'un
   juge, en le déclarant comme tel.

5. Ouverture et clôture des tours, publication des résultats.

6. Statuts compétiteur : présent, absent, abandon, disqualifié, avec motif.

7. Journal d'activité de la compétition, filtrable, exportable. C'est ce qui
   permettra de répondre à une réclamation trois semaines plus tard.
```

---

## Lot 9 — Phases, exports et durcissement

```
Lot 9 : compléter le format phases, les exports, et durcir l'ensemble.

1. Format phases de bout en bout : qualification à deux voies, calcul des
   qualifiés, bascule vers la demi-finale puis la finale, classement final avec
   contre-performance. Un test e2e joue une compétition complète.

2. Exports :
   - résultats CSV, par catégorie et global ;
   - résultats PDF mis en page, prêts à afficher et à archiver, avec le détail
     par voie ;
   - export complet de la compétition en JSON (sauvegarde, réimport).

3. Téléversement des vidéos : via l'interface `StorageAdapter`, avec limite de
   taille, transcodage ou refus des formats exotiques, et téléversement repris
   en cas de coupure.

4. Durcissement :
   - revue de sécurité complète des trois frontières (organisateur, juge, public) ;
   - test de charge sur le flux SSE et sur la synchronisation ;
   - sauvegarde automatique de la base et procédure de restauration testée,
     documentée dans `infra/scripts` ;
   - mode dégradé : que voit chaque acteur quand le serveur est injoignable ?
   - purge et export RGPD d'une compétition.

5. Documentation d'exploitation :
   - `docs/GUIDE-ORGANISATEUR.md` — préparer et piloter une compétition,
     écrit pour un bénévole, sans jargon ;
   - `docs/GUIDE-JUGE.md` — une page, imprimable, à donner à chaque juge le
     matin ;
   - `docs/EXPLOITATION.md` — déploiement, sauvegarde, restauration, incidents.

6. Répétition générale : joue une compétition complète de 60 compétiteurs,
   4 catégories, 8 voies, 4 juges, avec des coupures réseau provoquées.
   Raconte-moi ce qui casse.
```

---

## Conseils d'utilisation

**Une session par lot.** Ouvre une session fraîche pour chaque lot. Les
contextes longs dégradent la qualité, et `CLAUDE.md` recharge l'essentiel à
chaque fois.

**Mode plan d'abord.** Pour tout lot non trivial, commence en mode plan
(`Shift+Tab`), discute, puis exécute.

**Fais-le vérifier par un autre.** Après un lot sensible — 2, 4, 6 — lance une
session dédiée à la relecture :

> Relis le lot que je viens de terminer, sans rien modifier. Cherche les bugs,
> les cas limites non traités, les failles de sécurité et les écarts avec
> `SPEC.md`. Classe tes remarques par gravité. Pour chacune, donne le scénario
> concret qui la déclenche. Ne corrige rien, liste.

**Le moteur de cotation d'abord, toujours.** Si un seul lot doit être parfait,
c'est le 2. Une interface imparfaite se corrige entre deux compétitions ; un
classement faux se découvre sur le podium.

**Fais relire `packages/scoring/RULES.md` par un juge fédéral** avant la
première compétition réelle. C'est pour ça que ce document existe.
