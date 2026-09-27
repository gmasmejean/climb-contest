-- ADR-087 : désactivation des comptes et journal des actions sur les membres.
CREATE TABLE "organization_member_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"target_email" text NOT NULL,
	"target_display_name" text NOT NULL,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_log_action_check" CHECK ("organization_member_log"."action" IN ('invited', 'invitation_resent', 'invitation_cancelled', 'role_changed', 'deactivated', 'reactivated'))
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_member_log" ADD CONSTRAINT "organization_member_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_log" ADD CONSTRAINT "organization_member_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_member_log_organization_id_idx" ON "organization_member_log" USING btree ("organization_id","created_at");