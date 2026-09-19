CREATE TABLE "asset_upload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"declared_size_bytes" integer NOT NULL,
	"received_bytes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_upload_status_check" CHECK ("asset_upload"."status" IN ('uploading', 'completed', 'aborted')),
	CONSTRAINT "asset_upload_size_check" CHECK ("asset_upload"."declared_size_bytes" > 0 AND "asset_upload"."received_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_upload" ADD CONSTRAINT "asset_upload_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_upload_route_id_idx" ON "asset_upload" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "asset_upload_status_expires_idx" ON "asset_upload" USING btree ("status","expires_at");