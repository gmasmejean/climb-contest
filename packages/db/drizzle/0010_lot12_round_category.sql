CREATE TABLE "round_category" (
	"round_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_category_round_id_category_id_pk" PRIMARY KEY("round_id","category_id"),
	CONSTRAINT "round_category_status_check" CHECK ("round_category"."status" IN ('draft', 'open', 'closed', 'published'))
);
--> statement-breakpoint
ALTER TABLE "round" DROP CONSTRAINT "round_status_check";--> statement-breakpoint
ALTER TABLE "round_category" ADD CONSTRAINT "round_category_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_category" ADD CONSTRAINT "round_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-065 : l'ancien statut du tour est répliqué sur chaque catégorie liée au tour
-- (`round_route`). Un tour en `draft` n'écrit rien (ligne absente = brouillon).
INSERT INTO "round_category" ("round_id", "category_id", "status")
SELECT DISTINCT rr."round_id", rr."category_id", r."status"
FROM "round_route" rr
JOIN "round" r ON r."id" = rr."round_id"
WHERE r."status" <> 'draft';--> statement-breakpoint
ALTER TABLE "round" DROP COLUMN "status";