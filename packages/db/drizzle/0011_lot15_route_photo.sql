ALTER TABLE "asset" DROP CONSTRAINT "asset_kind_check";--> statement-breakpoint
ALTER TABLE "route" ADD COLUMN "photo_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "route" ADD COLUMN "photo_holds" jsonb;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_photo_asset_id_asset_id_fk" FOREIGN KEY ("photo_asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_kind_check" CHECK ("asset"."kind" IN ('video', 'route_photo'));