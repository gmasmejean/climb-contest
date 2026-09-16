# RULES.md — les règles de cotation, en français

Ce document explique les règles de calcul du classement telles
qu'implémentées dans `packages/scoring`, sans jargon de programmation. Il est
écrit pour être relu et validé par un juge fédéral FFME. Chaque règle est
suivie d'un exemple chiffré.

Ces règles suivent le cadre IFSC/FFME décrit dans `SPEC.md` §4, avec quelques
simplifications volontaires pour un contexte bénévole, expliquées ci-dessous
et justifiées dans `DECISIONS.md`.

---

## 1. Noter un passage

Un juge observe un grimpeur et note sa performance sous l'une de ces formes :

| Ce que le juge saisit                          | Ce que ça veut dire                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Un numéro de prise, ex. **25**                 | Le grimpeur a **contrôlé** la prise 25 : il s'en est servi pour tenir une position ou freiner un mouvement.                                                              |
| Un numéro de prise suivi de **+**, ex. **25+** | Il a contrôlé la prise 25 **et** amorcé un mouvement vers la 26, sans la contrôler.                                                                                      |
| **TOP**                                        | Il a mousquetonné la dégaine finale : c'est la meilleure performance possible sur cette voie.                                                                            |
| **DNS** (absent)                               | Il ne s'est jamais présenté, ou s'est présenté puis retiré avant de commencer à grimper.                                                                                 |
| **DNF** (interrompu)                           | Il a commencé à grimper mais son ascension a été interrompue anormalement (ex. blessure) — à ne pas confondre avec une chute normale, qui se note à la hauteur atteinte. |
| **DSQ** (disqualifié)                          | Décision de l'organisateur.                                                                                                                                              |

> **Simplification volontaire** : les règlements fédéraux distinguent parfois
> une prise "touchée mais non contrôlée" d'une prise "contrôlée". Cette
> application ne fait pas cette distinction : seuls "contrôlé" (n) et
> "amorcé vers la suivante" (n+) existent. Faire ce jugement fin, sous
> pression, avec un bénévole non formé, est une source d'erreurs et de
> contestations plus grande que la perte de précision. Si votre règlement
> l'exige formellement, il faut le signaler avant la première compétition.

Pour comparer deux performances sans ambiguïté, chaque saisie est traduite en
un nombre, la **valeur de score** :

- DNS, DNF ou DSQ → **0**
- TOP sur une voie de 40 prises → **41** (toujours plus que n'importe quelle prise)
- Prise 25 amorcée (25+) → **25,5**
- Prise 25 contrôlée → **25**

**Exemple** : sur une voie de 40 prises, un grimpeur qui tope vaut 41 ; un
grimpeur à 25+ vaut 25,5 ; un grimpeur à 25 vaut 25. L'ordre est donc :
TOP > 25+ > 25.

---

## 2. Classer les grimpeurs sur une voie

Les grimpeurs d'une même catégorie, sur une même voie, sont classés par
valeur de score décroissante. Quand deux grimpeurs ont exactement la même
valeur, on les départage, dans cet ordre :

1. **Le chrono**, si la compétition l'a activé : le plus rapide passe devant.
   Ce départage ne s'applique que si **les deux** grimpeurs concernés ont un
   temps enregistré.
2. **L'ex aequo véritable**, sinon : les deux grimpeurs restent à égalité, au
   même rang.

**La règle des ex aequo** : deux premiers ex aequo, le suivant est
**troisième**, pas deuxième. Le rang "saute" du nombre de personnes à
égalité (1, 2, 2, 4 — jamais 1, 2, 2, 3).

**Exemple (absence sur une voie)** : sur une voie donnée, deux grimpeurs
absents (DNS) valent chacun 0. Ils sont ex aequo entre eux, au dernier rang
partagé — pas classés l'un après l'autre à deux rangs distincts.

> Le départage par contre-performance (voir §3) n'intervient **pas** au
> niveau d'une seule voie dans cette implémentation : il n'a de sens que
> rapporté au classement global du tour précédent, pas à une voie isolée. Il
> est appliqué une seule fois, au niveau du tour (§3) — ce qui couvre aussi
> bien un tour à une seule voie qu'un tour à plusieurs voies, sans perdre en
> rigueur.

---

## 3. Classer un tour

### Tour à une seule voie

Le classement du tour est celui de la voie, éventuellement départagé par la
contre-performance (voir plus bas) si une égalité subsiste.

### Tour à plusieurs voies (ex. qualification sur 2 voies)

C'est le point le plus délicat, et le plus souvent mal implémenté ailleurs.
Pour chaque grimpeur, on prend son **rang** sur chaque voie (pas sa valeur de
score — son rang, 1er, 2e, 3e…), et on les combine par **moyenne
géométrique** :

```
rang combiné = racine k-ième de (rang voie 1 × rang voie 2 × … × rang voie k)
```

**Pourquoi pas une simple moyenne ?** Parce qu'une moyenne classique traite
un 1er + un 20e comme équivalent à deux 10e. La moyenne géométrique, elle, ne
s'y trompe pas.

**Exemple concret (le piège classique)** :

| Grimpeur | Rang voie 1 | Rang voie 2 | Moyenne arithmétique | Moyenne géométrique |
| -------- | ----------- | ----------- | -------------------- | ------------------- |
| A        | 1er         | 4e          | (1+4)/2 = **2,5**    | √(1×4) = **2,00**   |
| B        | 2e          | 2e          | (2+2)/2 = **2,0**    | √(2×2) = **2,00**   |

Avec une moyenne arithmétique, B (2,0) passerait devant A (2,5) — alors que A
a décroché une victoire de voie, ce qui doit compter autant qu'une régularité
en 2e position. Avec la moyenne géométrique, **A et B sont exactement à
égalité** (2,00 = 2,00). C'est le comportement attendu et voulu.

**Absence sur une voie** : un grimpeur absent sur une voie du tour reçoit,
sur cette voie, le rang le plus défavorable — partagé avec tous les autres
absents de cette même voie (voir §2, ex aequo). Il n'est jamais exclu du
calcul.

---

## 4. La contre-performance (départage entre tours)

Quand deux grimpeurs sont encore à égalité après la moyenne géométrique (ou
sur une voie unique), on les départage par leur classement au **tour
précédent** : celui qui était mieux classé au tour d'avant passe devant.

- **Premier tour de la compétition** : pas de tour précédent, donc pas de
  départage possible → ex aequo véritable.
- **Toujours à égalité après le tour précédent** : la comparaison remonte
  naturellement encore plus loin, parce que le classement de CE tour
  précédent a lui-même déjà été départagé par SON propre tour précédent, et
  ainsi de suite. Un juge ou un organisateur n'a jamais besoin de remonter
  l'historique à la main — le calcul le fait déjà.

---

## 5. Format « phases » : qualifiés et classement final

**Qui se qualifie pour le tour suivant** : les N premiers du classement du
tour, N étant décidé à l'avance par l'organisateur. **En cas d'égalité à la
limite, tous les ex aequo sont qualifiés** — c'est plus juste qu'un tirage au
sort, mais ça veut dire que le tour suivant peut compter plus de
participants que prévu.

_Exemple_ : 10 qualifiés prévus, mais les 10e et 11e sont ex aequo → les
**11** sont qualifiés.

**Le classement final** est celui du **dernier tour auquel chaque grimpeur a
participé**. Règle non négociable : **un finaliste est toujours classé
devant un demi-finaliste non qualifié, quelle que soit sa performance en
finale.**

_Exemple_ : un grimpeur termine dernier de la finale. Un autre grimpeur,
très performant en demi-finale, ne s'est pas qualifié pour la finale. Le
finaliste (même dernier) est classé devant le demi-finaliste non qualifié
(même 1er de son tour). Atteindre un tour plus loin compte plus que la
performance brute dans un tour antérieur.

---

## 6. Format « contest » : somme des meilleures voies

Configuré à la création de la compétition : un nombre **M** de voies
retenues par grimpeur (« routes_counted »).

```
score total = somme des M plus grandes valeurs de score du grimpeur
```

_Exemple_ : M = 3, un grimpeur a grimpé 5 voies notées 30, 28, 25, 20 et 10.
Seules les 3 meilleures comptent : 30 + 28 + 25 = **83**. S'il n'a grimpé que
2 voies, ce sont ces 2-là qui comptent (pas de pénalité pour voies non
tentées au-delà de M).

**Égalité de score total**, départagée dans cet ordre :

1. **Le nombre de TOP** parmi les M voies retenues : le plus de tops passe
   devant.
2. **Le nombre de voies tentées** (toutes voies confondues, y compris celles
   qui ne comptent pas dans le total) : **moins, c'est mieux** — un score
   obtenu en moins de tentatives est plus impressionnant.
3. Sinon, ex aequo véritable.

> ⚠️ **À valider par le juge fédéral** : le critère 2 (nombre de voies
> tentées) n'est décrit par aucun exemple chiffré dans le cahier des charges
> d'origine — c'est une interprétation raisonnable mais non testée par un
> cas concret. Merci de confirmer qu'elle correspond bien à la pratique
> fédérale avant la première compétition officielle.

_Exemple testé_ : M = 3, deux grimpeurs totalisent chacun 83 points, mais
l'un a réalisé 2 tops parmi ses 3 voies retenues et l'autre un seul → le
premier passe devant.

---

## 7. Ce qui n'est délibérément pas couvert en v1

- Le chronométrage de départage est saisi à la main, jamais déclenché par
  l'application.
- Un seul mode de calcul est implémenté pour le format contest ("somme des M
  meilleures") — le mode "points par prise" est décrit dans `SPEC.md` mais
  différé (voir `DECISIONS.md`).
- L'ordre de passage et l'isolement en demi-finale/finale ne sont pas
  modélisés — gérés sur papier par l'organisateur.
