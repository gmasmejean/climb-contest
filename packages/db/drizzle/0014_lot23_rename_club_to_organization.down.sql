-- ADR-086 : retour au nom `club`. Renommage pur, aucune perte de données.
ALTER INDEX "competition_deletion_log_organization_id_idx" RENAME TO "competition_deletion_log_club_id_idx";--> statement-breakpoint
ALTER TABLE "competition_deletion_log" RENAME CONSTRAINT "competition_deletion_log_organization_id_organization_id_fk" TO "competition_deletion_log_club_id_club_id_fk";--> statement-breakpoint
ALTER TABLE "competition_deletion_log" RENAME COLUMN "organization_id" TO "club_id";--> statement-breakpoint
ALTER TABLE "competition" RENAME CONSTRAINT "competition_organization_id_organization_id_fk" TO "competition_club_id_club_id_fk";--> statement-breakpoint
ALTER TABLE "competition" RENAME COLUMN "organization_id" TO "club_id";--> statement-breakpoint
ALTER TABLE "user" RENAME CONSTRAINT "user_organization_id_organization_id_fk" TO "user_club_id_club_id_fk";--> statement-breakpoint
ALTER TABLE "user" RENAME COLUMN "organization_id" TO "club_id";--> statement-breakpoint
ALTER TABLE "organization" RENAME CONSTRAINT "organization_slug_unique" TO "club_slug_unique";--> statement-breakpoint
ALTER TABLE "organization" RENAME CONSTRAINT "organization_pkey" TO "club_pkey";--> statement-breakpoint
ALTER TABLE "organization" RENAME TO "club";
