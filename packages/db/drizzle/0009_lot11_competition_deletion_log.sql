CREATE TABLE "competition_deletion_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"competition_name" text NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_deletion_log_action_check" CHECK ("competition_deletion_log"."action" IN ('trashed', 'restored', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "competition_deletion_log" ADD CONSTRAINT "competition_deletion_log_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_deletion_log" ADD CONSTRAINT "competition_deletion_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competition_deletion_log_club_id_idx" ON "competition_deletion_log" USING btree ("club_id","created_at");