# Guide de l'organisateur

*Pour préparer et piloter une compétition, sans être informaticien.*

Tout se passe dans **Mes compétitions**, puis dans la compétition, à travers ses onglets : **Infos, Catégories, Compétiteurs, Voies, Tours** (format phases seulement), **Juges, Prêt à démarrer ?, Pilotage, Exports**.

---

## 1. Préparer (les jours avant)

### Créer la compétition
**Nouvelle compétition** : nom, lieu, dates, et le **format** :
- **Contest** : chacun grimpe plusieurs voies, on retient ses meilleures (vous choisissez combien).
- **Phases** : qualification, puis demi-finale, puis finale, avec des qualifiés à chaque étape.

Vous ne pourrez pas changer de format après coup : choisissez avec soin.

### Catégories
Onglet **Catégories** : partez du **modèle FFME** (U12 à Vétéran, hommes et femmes) ou créez les vôtres. Une catégorie qui contient des compétiteurs ne peut pas être supprimée.

### Compétiteurs
Onglet **Compétiteurs** :
- **Un par un** : le formulaire se vide et garde le curseur, vous pouvez en saisir trente à la suite au clavier.
- **Par fichier CSV** : colonnes `dossard`, `prenom`, `nom`, `categorie`, `annee_naissance`, `club`, `licence` (seules `prenom`, `nom` et `categorie` sont obligatoires). Un **aperçu** s'affiche d'abord, avec les erreurs ligne par ligne. **Rien n'est écrit tant que vous n'avez pas validé**, et si une seule ligne est en erreur, rien n'est importé : corrigez le fichier et recommencez.
- **Assigner les dossards automatiquement** : numérote ceux qui n'en ont pas, sans toucher aux dossards déjà donnés.

### Voies
Onglet **Voies** : numéro, nom, nombre de prises, secteur, couleur, et les **catégories concernées**. Un lien YouTube ou Vimeo peut être ajouté, ou une vidéo téléversée en modifiant la voie (MP4, MOV ou WebM ; l'envoi reprend tout seul après une coupure). Le nombre de prises ne peut plus être changé dès qu'un passage a été noté.

### Tours (format phases)
Onglet **Tours** : créez qualification, demi-finale, finale ; indiquez **combien de qualifiés** passent au tour suivant, et quelles voies servent à quelle catégorie.

### Juges
Onglet **Juges** : **Créer le juge** (son nom et ses voies). Vous obtenez un **lien** et un **QR code** — et un code à 6 chiffres si vous avez activé le code d'accès. **Planche de QR codes (PDF)** imprime un encart par juge et une page pour le public, à afficher dans la salle.

### La veille au soir : « Prêt à démarrer ? »
Cet onglet liste ce qui manque : catégorie sans voie, voie sans catégorie, compétiteur sans dossard, voie sans juge, tour sans voie. **Regardez-le la veille.**

---

## 2. Le jour J

### Ouvrir
Dans **Infos**, passez la compétition à **En cours**, puis ouvrez le premier tour dans **Pilotage → Tours** (**Ouvrir**). Tant qu'un tour n'est pas ouvert, les juges voient « Aucun tour ouvert ».

### Suivre : Pilotage → Vue d'ensemble
L'avancement par catégorie et par voie, l'état de chaque juge (dernier signe de vie, nombre de saisies) et des **alertes** : voie sans saisie depuis 15 minutes, juge muet depuis 10 minutes, conflit non résolu, compétiteur sans aucun passage alors que le tour est fermé. La page se rafraîchit toute seule.

> **Si un bandeau rouge « Le serveur ne répond plus » apparaît**, les chiffres dessous sont **figés** : ne vous y fiez pas. Les juges continuent à noter (leurs saisies sont gardées sur leurs téléphones) et tout se remet à jour au retour du réseau.

### Corriger
**Pilotage → Voies** : choisissez le tour et la voie, puis **Corriger** un passage. Un **motif est obligatoire**. L'ancienne valeur est conservée, jamais effacée.

### Saisir à la place d'un juge
Même écran : **Saisir (secours)** sur un compétiteur sans passage (téléphone mort, juge absent, accès arrêté). Elle est enregistrée comme faite par vous.

### Conflits
**Pilotage → Conflits** : deux appareils ont noté des valeurs différentes. Vous voyez les deux côte à côte (juge, appareil, heure) et vous **choisissez l'une**, ou vous saisissez une **troisième valeur**. Tant que le conflit n'est pas tranché, ce passage ne compte pas dans le classement, et **le tour ne peut pas être publié**.

### Statut d'un compétiteur
Dans **Compétiteurs**, bouton **Statut** : présent, absent, abandon, disqualifié (le motif est facultatif). **Déclarez les absents avant de fermer un tour.**

### Passer d'un tour à l'autre (phases)
1. **Fermer** le tour qui se termine (Pilotage → Tours).
2. **Ouvrir** le suivant. **La liste des qualifiés est alors figée** : un abandon ou une correction ultérieure ne fait entrer ni sortir personne. Vous la voyez sous le tour (« Qualifiés de ce tour »). S'il y a **égalité à la limite**, tous les ex aequo passent et l'écran le signale.
3. Les juges voient alors **uniquement les qualifiés**. Un juge déjà connecté touche **Actualiser mes voies** (ou rouvre l'application).

Ouvert trop tôt ? **Repasser en brouillon** est possible tant que le tour n'a aucun passage.

### Publier
**Publier les résultats** rend le classement définitif : le mot « provisoire » disparaît de la page publique. Impossible tant qu'un conflit du tour n'est pas tranché. Pour **dépublier**, touchez **Fermer** sur un tour publié.

---

## 3. Après la compétition

### Résultats
Onglet **Exports** : **Résultats en PDF** (prêt à afficher ou archiver, avec le détail par voie) et **en CSV** (pour un tableur), pour une catégorie ou toutes. Tant que tout n'est pas publié, ils portent la mention « provisoire ».

### Sauvegarde
**Télécharger la sauvegarde** : toute la compétition, historique des saisies compris, dans un fichier à garder au chaud. **Mes compétitions → Importer une sauvegarde** la recrée comme une **nouvelle** compétition (aperçu d'abord). Les accès des juges ne sont pas restaurés : recréez-les et réimprimez les QR codes.

### Retrouver une compétition
Dans **Mes compétitions**, tapez le début d'un nom ou d'un lieu dans **Rechercher** (les accents et les majuscules ne comptent pas). **Trier par** propose la date, le nom ou le statut. **Filtres** permet de ne garder que certains statuts, ou que les compétitions **à venir ou en cours** / **passées**, ou une période. **Réinitialiser** remet tout comme au début. Si vous rechargez la page, votre recherche est conservée.

### Supprimer une compétition (la corbeille)
Dans **Mes compétitions**, **Sélectionner**, cochez une ou plusieurs compétitions, puis **Mettre à la corbeille**. Il n'y a pas de confirmation : rien n'est effacé, vous pouvez tout défaire. Une compétition **« En cours »** ne peut pas être mise à la corbeille : passez-la à **Clôturée** dans **Infos** d'abord.

Une compétition à la corbeille disparaît de votre liste, et **les juges ne peuvent plus saisir ni ouvrir leur lien**, le public non plus. Les passages qu'un juge avait saisis mais pas encore envoyés restent sur son téléphone et partent quand vous restaurez.

Ouvrez **Corbeille** (en haut de la liste) pour **Restaurer** : la compétition revient exactement comme elle était. **Supprimer définitivement** efface la compétition **et toutes ses données** (compétiteurs, passages, résultats, accès des juges, vidéos) : c'est irréversible et on vous demande de confirmer. Faites d'abord une **sauvegarde** si vous voulez en garder une copie. Tout organisateur du club peut supprimer ou restaurer.

> **Différence avec la suppression des données personnelles (RGPD)** : celle-ci efface les noms et garde les résultats. La corbeille supprime la compétition entière.

### Données personnelles (RGPD)
Les compétiteurs sont souvent mineurs. Seul le **propriétaire du club** peut, dans **Exports**, **exporter les données personnelles** puis les **supprimer**. La suppression est **définitive** : noms, années de naissance, clubs, licences, vidéos et motifs disparaissent, les résultats restent sans personne derrière, et le lien public cesse de marcher. Il faut retaper le nom exact de la compétition. La liste des compétitions vous **rappelle** au bout de 2 ans, puis 5 ans ; rien n'est jamais supprimé tout seul.

> Supprimer une compétition ne supprime **pas** les anciennes sauvegardes qui la contiennent : rangez-les avec soin.

---

## 4. Quand ça ne va pas

| Problème | Que faire |
|---|---|
| **Le serveur ne répond plus** | Les juges continuent ; ne changez rien. Attendez le retour du réseau. Ne rechargez pas la page : vous seriez renvoyé à la connexion. |
| **Un juge dit « en attente » longtemps** | Vérifiez sa dernière activité dans la Vue d'ensemble. Si son accès a été révoqué, ses saisies en attente ne partiront pas : faites-les ressaisir avec **Saisir (secours)**. |
| **Un juge a perdu son lien** | Onglet **Juges**, bouton **Voir l'accès**. Si le juge a un code, **Régénérer le PIN** ; sinon, **Révoquer** son accès et recréez-le pour obtenir un nouveau lien. |
| **Un classement public semble bloqué** | Le public voit « Reconnexion… » : la page se remet à jour toute seule. Un classement « provisoire » n'est pas une panne. |
| **Erreur de saisie découverte tard** | **Corriger** avec un motif (Pilotage → Voies). En phases, si un tour suivant est ouvert, la liste des qualifiés ne change plus. |
| **J'ai supprimé une compétition par erreur** | **Mes compétitions → Corbeille → Restaurer**. Tant que vous n'avez pas choisi « Supprimer définitivement », rien n'est perdu. |
| **Vidéo qui ne s'envoie pas** | Le fichier doit être MP4, MOV ou WebM et respecter la taille maximale (200 Mo par défaut). Un lien YouTube ou Vimeo marche toujours. |
