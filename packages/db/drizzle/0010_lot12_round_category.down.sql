-- ADR-065 : retour au statut par tour. PERTE ASSUMÉE quand les catégories d'un tour
-- ont des états différents : `open` l'emporte dès qu'une catégorie est ouverte (une
-- saisie en cours n'est jamais coupée), sinon l'état le plus avancé.
ALTER TABLE "round" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
UPDATE "round" r
SET "status" = agg."status"
FROM (
	SELECT "round_id",
		CASE
			WHEN bool_or("status" = 'open') THEN 'open'
			WHEN bool_or("status" = 'published') THEN 'published'
			WHEN bool_or("status" = 'closed') THEN 'closed'
			ELSE 'draft'
		END AS "status"
	FROM "round_category"
	GROUP BY "round_id"
) agg
WHERE agg."round_id" = r."id";--> statement-breakpoint
ALTER TABLE "round" ADD CONSTRAINT "round_status_check" CHECK ("round"."status" IN ('draft', 'open', 'closed', 'published'));--> statement-breakpoint
DROP TABLE "round_category";
