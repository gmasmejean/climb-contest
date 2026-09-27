-- ADR-086 : le `club` devient l'`organization` (club, salle ou autre structure).
-- Renommage pur, sans perte : les lignes, les clés et les index sont conservés ;
-- seuls les noms changent, pour suivre ceux que Drizzle attend.
ALTER TABLE "club" RENAME TO "organization";--> statement-breakpoint
ALTER TABLE "organization" RENAME CONSTRAINT "club_pkey" TO "organization_pkey";--> statement-breakpoint
ALTER TABLE "organization" RENAME CONSTRAINT "club_slug_unique" TO "organization_slug_unique";--> statement-breakpoint
ALTER TABLE "user" RENAME COLUMN "club_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "user" RENAME CONSTRAINT "user_club_id_club_id_fk" TO "user_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "competition" RENAME COLUMN "club_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "competition" RENAME CONSTRAINT "competition_club_id_club_id_fk" TO "competition_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "competition_deletion_log" RENAME COLUMN "club_id" TO "organization_id";--> statement-breakpoint
ALTER TABLE "competition_deletion_log" RENAME CONSTRAINT "competition_deletion_log_club_id_club_id_fk" TO "competition_deletion_log_organization_id_organization_id_fk";--> statement-breakpoint
ALTER INDEX "competition_deletion_log_club_id_idx" RENAME TO "competition_deletion_log_organization_id_idx";
