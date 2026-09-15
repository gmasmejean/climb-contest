# Prompt initial — à coller dans Claude Code

> **Mode d'emploi**
> 1. Crée un dossier vide, `cd` dedans, lance `claude`.
> 2. Copie `CLAUDE.md`, `SPEC.md` et `ROADMAP.md` à la racine du dossier.
> 3. Passe en **mode plan** (`Shift+Tab` deux fois) et colle le prompt ci-dessous.
> 4. Discute le plan, fais-le corriger, puis valide. Ne sors du mode plan que quand le plan te convient.
> 5. Ensuite, et seulement ensuite, envoie le prompt du **Lot 1** (dans `ROADMAP.md`).

---

## Le prompt

```
Tu vas m'aider à construire, de zéro, une application web (PWA) de gestion de
compétitions d'escalade de difficulté, destinée aux clubs. Je suis seul sur le
projet, développeur full-stack, à l'aise en TypeScript/Vue, et je vais l'utiliser
en vrai le jour d'une compétition — la fiabilité terrain prime sur les
fonctionnalités.

Trois documents sont à la racine du dépôt. Lis-les INTÉGRALEMENT avant toute
chose, dans cet ordre :

  1. CLAUDE.md   — les règles de travail sur ce projet
  2. SPEC.md     — le domaine métier, le modèle de données, les règles de cotation
  3. ROADMAP.md  — le découpage en lots de livraison

Ta mission dans ce premier échange est UNIQUEMENT de produire un plan. Tu
n'écris aucun code, tu ne crées aucun fichier, tu ne lances aucune commande
d'installation.

Livre-moi, dans ta réponse :

1. **Un compte rendu de lecture critique de SPEC.md.**
   - Les zones où la spécification est ambiguë, contradictoire ou incomplète.
   - Les cas limites métier que je n'ai pas prévus (un juge note deux fois le
     même grimpeur, un grimpeur change de catégorie en cours de route, une voie
     est retirée après des passages, deux tablettes hors ligne saisissent des
     valeurs différentes pour le même passage, une égalité parfaite en finale…).
   - Les décisions que tu recommandes pour chacun, avec une ligne de
     justification. Pose-moi une question ciblée quand tu ne peux pas trancher
     seul — pas plus de dix questions, les plus structurantes d'abord.

2. **Une proposition de stack argumentée.**
   Mes contraintes : TypeScript partout, PWA robuste hors ligne, temps réel pour
   le classement public, pas de verrouillage fournisseur (je dois pouvoir
   déménager d'hébergeur sans réécrire), maintenabilité par une seule personne
   sur plusieurs années, et un chemin crédible vers de l'auto-hébergement Docker.
   SPEC.md contient une stack de référence : traite-la comme une proposition à
   challenger, pas comme un acquis. Dis-moi où tu es d'accord, où tu ne l'es pas,
   et ce que tu ferais différemment. Sur les points de désaccord, présente le
   compromis (coût, complexité, risque) plutôt qu'une simple préférence.

3. **L'architecture cible.**
   - Arborescence du monorepo, avec le rôle de chaque paquet.
   - Où vit la logique de cotation et de classement, et comment elle est
     partagée entre serveur et client sans duplication.
   - La stratégie hors ligne de bout en bout : ce qui est mis en cache, ce qui
     est mis en file d'attente, comment la synchronisation se réconcilie, ce qui
     se passe en cas de conflit.
   - La stratégie temps réel, et ce qui se passe quand elle tombe.
   - La frontière de sécurité entre organisateur, juge et public.

4. **Une critique de ROADMAP.md.**
   Le découpage en lots te paraît-il bon ? Qu'est-ce que tu réordonnerais, et
   pourquoi ? Y a-t-il une dépendance manquante entre deux lots ?

Deux règles pour ce plan : sois concret (des noms de fichiers, des noms de
tables, des signatures de fonctions — pas des généralités), et sois franc. Si
une partie de ma spécification est une mauvaise idée, dis-le et propose mieux.
Je préfère une objection maintenant qu'une réécriture dans trois semaines.
```

---

## Ce qu'il faut attendre de cet échange

Un bon plan de Claude Code te renverra des questions gênantes. C'est le signe
que ça marche. Les points sur lesquels il **doit** buter, parce que `SPEC.md` les
laisse volontairement ouverts :

- l'ordre de passage et l'isolement en format phases (tu ne les as pas demandés,
  mais une finale sans ordre de passage est bancale) ;
- ce qui fait foi quand deux juges notent le même passage ;
- si le chronomètre de départage est saisi à la main ou déclenché dans l'appli ;
- la reprise d'une compétition dont le serveur a été inaccessible une heure.

Tranche ces points **avant** de lancer le Lot 1. Chaque décision prise ici
t'économise une journée de refonte plus tard.

## Après le plan

Demande-lui d'écrire les décisions dans un fichier :

```
Écris maintenant un fichier DECISIONS.md à la racine, qui consigne chaque
décision d'architecture arrêtée pendant ce plan : le contexte, l'option
retenue, les options écartées et pourquoi. Une entrée par décision, datée,
numérotée (ADR-001, ADR-002…). Puis mets à jour SPEC.md pour y intégrer les
arbitrages que nous venons de prendre, en signalant chaque modification.
```

Ensuite seulement, Lot 1.
