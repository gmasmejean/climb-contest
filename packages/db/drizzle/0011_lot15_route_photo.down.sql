-- ADR-066 : retour sans photo de voie. PERTE ASSUMÉE : les lignes `asset` de type
-- `route_photo` sont supprimées (le CHECK d'avant n'accepte que `video`), et les
-- fichiers correspondants restent orphelins sur le disque de stockage.
ALTER TABLE "route" DROP CONSTRAINT "route_photo_asset_id_asset_id_fk";--> statement-breakpoint
ALTER TABLE "route" DROP COLUMN "photo_holds";--> statement-breakpoint
ALTER TABLE "route" DROP COLUMN "photo_asset_id";--> statement-breakpoint
DELETE FROM "asset" WHERE "kind" = 'route_photo';--> statement-breakpoint
ALTER TABLE "asset" DROP CONSTRAINT "asset_kind_check";--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_kind_check" CHECK ("asset"."kind" IN ('video'));
