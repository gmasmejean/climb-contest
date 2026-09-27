-- ADR-088 : fiche de l'organisation (type, description, contact, site, adresse).
ALTER TABLE "organization" ADD COLUMN "type" text DEFAULT 'club' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "address_label" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "ban_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_type_check" CHECK ("organization"."type" IN ('club', 'gym', 'other'));--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_position_check" CHECK (("organization"."latitude" IS NULL AND "organization"."longitude" IS NULL) OR ("organization"."latitude" IS NOT NULL AND "organization"."longitude" IS NOT NULL AND "organization"."latitude" BETWEEN -90 AND 90 AND "organization"."longitude" BETWEEN -180 AND 180));--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_address_check" CHECK ("organization"."address_label" IS NOT NULL OR ("organization"."postcode" IS NULL AND "organization"."city" IS NULL AND "organization"."latitude" IS NULL AND "organization"."ban_id" IS NULL));