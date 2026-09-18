CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_event_type_check" CHECK ("activity_log"."event_type" IN ('round_status_changed', 'competitor_status_changed')),
	CONSTRAINT "activity_log_actor_type_check" CHECK ("activity_log"."actor_type" IN ('organizer', 'system'))
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_competition_id_idx" ON "activity_log" USING btree ("competition_id");