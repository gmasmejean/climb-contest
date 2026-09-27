-- ADR-087 : retour sans gestion des membres. PERTE ASSUMÉE : le journal des
-- membres est supprimé, et un compte désactivé redevient actif (la colonne
-- disparaît) — à réserver à un retour arrière juste après le déploiement.
DROP TABLE "organization_member_log";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "deactivated_at";
