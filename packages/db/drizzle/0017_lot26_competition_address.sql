-- ADR-089 : adresse du lieu des compétitions (copie de celle de l'organisation, ou saisie).
ALTER TABLE "competition" ADD COLUMN "address_label" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "ban_id" text;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_position_check" CHECK (("competition"."latitude" IS NULL AND "competition"."longitude" IS NULL) OR ("competition"."latitude" IS NOT NULL AND "competition"."longitude" IS NOT NULL AND "competition"."latitude" BETWEEN -90 AND 90 AND "competition"."longitude" BETWEEN -180 AND 180));--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_address_check" CHECK ("competition"."address_label" IS NOT NULL OR ("competition"."postcode" IS NULL AND "competition"."city" IS NULL AND "competition"."latitude" IS NULL AND "competition"."ban_id" IS NULL));