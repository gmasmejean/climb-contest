-- ADR-090 : photos de la fiche de l'organisation (6 actives au plus, suppression logique).
CREATE TABLE "organization_photo" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer NOT NULL,
	"alt_text" text,
	"uploaded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_photo_mime_type_check" CHECK ("organization_photo"."mime_type" = 'image/jpeg'),
	CONSTRAINT "organization_photo_size_check" CHECK ("organization_photo"."size_bytes" > 0),
	CONSTRAINT "organization_photo_position_check" CHECK ("organization_photo"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_photo_organization_id_idx" ON "organization_photo" USING btree ("organization_id","position");