-- ADR-089 : retour sans adresse de compétition. PERTE ASSUMÉE : les adresses
-- saisies sont supprimées ; `venue` (nom du lieu) reste.
ALTER TABLE "competition" DROP CONSTRAINT "competition_address_check";--> statement-breakpoint
ALTER TABLE "competition" DROP CONSTRAINT "competition_position_check";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "ban_id";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "longitude";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "postcode";--> statement-breakpoint
ALTER TABLE "competition" DROP COLUMN "address_label";
