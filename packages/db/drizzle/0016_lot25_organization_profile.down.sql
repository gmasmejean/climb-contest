-- ADR-088 : retour sans fiche d'organisation. PERTE ASSUMÉE : type,
-- description, contact, site et adresse saisis sont supprimés.
ALTER TABLE "organization" DROP CONSTRAINT "organization_address_check";--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_position_check";--> statement-breakpoint
ALTER TABLE "organization" DROP CONSTRAINT "organization_type_check";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "ban_id";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "longitude";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "postcode";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "address_label";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "website_url";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "contact_phone";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "contact_email";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "type";
