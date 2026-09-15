# CLAUDE.md — règles de travail sur ce projet

Ce fichier est lu automatiquement à chaque session. Il décrit comment on
travaille ici, pas ce qu'on construit (ça, c'est `SPEC.md`).

## Le projet en une phrase

Une PWA de gestion de compétitions d'escalade de **difficulté** pour les clubs :
les organisateurs préparent la compétition, les juges notent les passages depuis
leur téléphone (y compris sans réseau), le public suit le classement en direct.

## Contexte d'usage — à garder en tête à chaque décision

Ce n'est pas une application de bureau. Elle est utilisée :

- **par des bénévoles**, souvent pour la première fois, sans formation ;
- **sur des téléphones personnels** de toutes générations, en plein soleil ou
  dans une salle sombre, avec des mains froides ou magnésiées ;
- **avec un réseau catastrophique** — salle en sous-sol, 200 personnes sur la
  même borne wifi, 4G saturée ;
- **sous pression de temps** : un grimpeur attend, la file s'allonge.

Conséquences non négociables :

1. **Une action de juge ne doit jamais être perdue.** Jamais. Si le réseau
   tombe, elle part dans une file locale et remonte plus tard. Le juge voit
   toujours l'état de sa saisie (enregistrée localement / envoyée / confirmée).
2. **Aucun écran de juge ne doit dépendre d'une requête réseau pour s'afficher.**
3. **Toute saisie destructive est réversible** et laisse une trace.
4. Cibles tactiles ≥ 48 px, contraste AA minimum, pas de geste caché.
5. Les erreurs sont écrites en français, en langage humain, et disent quoi faire.

## Principes de développement

### Langue

- Code, noms de variables, noms de tables, commentaires techniques : **anglais**.
- Interface utilisateur, messages d'erreur, documentation produit : **français**.
- Le vocabulaire métier garde les termes français quand ils n'ont pas
  d'équivalent clair : `voie` → `route`, `prise` → `hold`, `dossard` → `bib`,
  `manche`/`tour` → `round`, `passage` → `ascent`, `cotation` → `scoring`.
  Le glossaire de `SPEC.md` fait foi. Ne l'invente pas, ne le contourne pas.

### Qualité

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true`.
  Aucun `any`, aucun `as` de confort, aucun `@ts-ignore`. Si le typage résiste,
  c'est le modèle qui est faux — corrige le modèle.
- **Validation aux frontières.** Chaque entrée HTTP est validée par un schéma
  Zod partagé entre client et serveur. Les types sont dérivés des schémas, pas
  écrits deux fois.
- **La logique métier est pure et testée.** Le calcul de score, le classement,
  les départages, la résolution de conflits hors ligne : fonctions pures, dans
  un paquet partagé, sans accès base ni réseau. Elles ont la plus forte densité
  de tests du projet.
- **Pas d'ORM magique sur le chemin critique.** Les requêtes de classement sont
  écrites et lisibles.

### Tests

- Tout calcul de score ou de classement arrive avec ses tests **en même temps**
  que le code, jamais après.
- Les tests de classement utilisent les scénarios de `SPEC.md` § Cas de test,
  repris littéralement. Ils sont la définition de « correct ».
- Parcours critiques en end-to-end (Playwright) : un juge note un passage hors
  ligne et le retrouve après reconnexion ; le classement public se met à jour
  en direct.
- Avant de dire qu'une tâche est finie : `pnpm typecheck && pnpm lint && pnpm test`
  passent. Tu lances les commandes, tu ne les supposes pas.

### Git

- Une branche par lot, des commits petits et atomiques, messages en anglais au
  format Conventional Commits (`feat(scoring): …`).
- Jamais de commit sur `main` directement.
- Jamais de `git push`, de `git commit --amend` sur du poussé, ni de
  `git rebase` sans que je le demande explicitement.

## Comment tu travailles avec moi

- **Tu poses des questions plutôt que de deviner.** Une hypothèse silencieuse
  sur une règle de cotation, c'est une compétition faussée. Face à une ambiguïté
  métier : tu t'arrêtes et tu demandes.
- **Tu me contredis quand j'ai tort.** Y compris sur `SPEC.md`, que j'ai écrite
  avec toi et qui n'est pas sacrée. Une objection argumentée maintenant vaut
  mieux qu'une réécriture plus tard.
- **Un lot à la fois.** Tu ne prends pas d'avance sur la roadmap, tu n'ajoutes
  pas de fonctionnalité que je n'ai pas demandée, tu ne « prépares pas le
  terrain » pour un lot ultérieur. Si tu vois quelque chose à faire, note-le
  dans `TODO.md` et continue.
- **Tu ne réécris pas ce qui marche.** Refactorisation large = tu demandes
  d'abord.
- **Rien de simulé.** Pas de données bidon codées en dur pour faire passer un
  test, pas de fonction qui renvoie une valeur plausible en attendant. Si une
  partie n'est pas implémentée, elle jette une erreur explicite.
- **Tu dis quand tu n'es pas sûr.** « Je pense que la FFME compte comme ça,
  à vérifier » est une réponse acceptable. Une affirmation fausse assénée avec
  aplomb ne l'est pas.

## Définition de « terminé » pour un lot

Un lot n'est pas fini tant que les six points ne sont pas vrais :

1. La fonctionnalité marche, vérifiée par toi dans un navigateur réel.
2. `typecheck`, `lint` et `test` passent.
3. Les cas limites listés dans le lot sont couverts par des tests.
4. Les migrations de base sont réversibles et ont été testées dans les deux sens.
5. Les écrans touchés sont utilisables sur un écran de 360 px de large.
6. `README.md` et `DECISIONS.md` reflètent ce qui a changé.

## Fichiers de référence

| Fichier | Rôle |
|---|---|
| `SPEC.md` | Le domaine métier, le modèle de données, les règles. Autorité sur le « quoi ». |
| `ROADMAP.md` | Le découpage en lots et leur ordre. |
| `DECISIONS.md` | Les décisions d'architecture prises, datées et justifiées (ADR). |
| `TODO.md` | Les choses repérées en chemin et volontairement remises à plus tard. |

Quand une décision est prise en conversation, tu l'écris dans `DECISIONS.md`
avant de passer à la suite. Ce qui n'est pas écrit sera perdu à la prochaine
session.
