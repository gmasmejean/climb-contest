CREATE TABLE "round_qualifier" (
	"round_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"source_round_id" uuid NOT NULL,
	"source_rank" integer NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_by_user_id" uuid,
	CONSTRAINT "round_qualifier_round_id_competitor_id_pk" PRIMARY KEY("round_id","competitor_id"),
	CONSTRAINT "round_qualifier_source_rank_check" CHECK ("round_qualifier"."source_rank" >= 1)
);
--> statement-breakpoint
ALTER TABLE "round_qualifier" ADD CONSTRAINT "round_qualifier_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifier" ADD CONSTRAINT "round_qualifier_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifier" ADD CONSTRAINT "round_qualifier_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifier" ADD CONSTRAINT "round_qualifier_source_round_id_round_id_fk" FOREIGN KEY ("source_round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_qualifier" ADD CONSTRAINT "round_qualifier_frozen_by_user_id_user_id_fk" FOREIGN KEY ("frozen_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "round_qualifier_round_category_idx" ON "round_qualifier" USING btree ("round_id","category_id");