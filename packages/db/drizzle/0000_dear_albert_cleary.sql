CREATE TABLE "ascent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"competitor_id" uuid NOT NULL,
	"hold_number" integer,
	"hold_count" integer NOT NULL,
	"modifier" text DEFAULT 'none' NOT NULL,
	"is_top" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'valid' NOT NULL,
	"score_value" numeric(6, 1) GENERATED ALWAYS AS (
          CASE
            WHEN status IN ('dns', 'dnf', 'dsq') THEN 0
            WHEN is_top THEN hold_count + 1
            WHEN modifier = 'plus' THEN hold_number + 0.5
            ELSE hold_number
          END
        ) STORED NOT NULL,
	"climb_time_ms" integer,
	"recorded_by_judge_id" uuid,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_id" text NOT NULL,
	"superseded_by" uuid,
	"conflict_group" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ascent_modifier_check" CHECK ("ascent"."modifier" IN ('none', 'plus')),
	CONSTRAINT "ascent_status_check" CHECK ("ascent"."status" IN ('valid', 'dns', 'dnf', 'dsq')),
	CONSTRAINT "ascent_hold_count_check" CHECK ("ascent"."hold_count" > 0),
	CONSTRAINT "ascent_recorded_by_check" CHECK (("ascent"."recorded_by_judge_id" IS NULL) <> ("ascent"."recorded_by_user_id" IS NULL)),
	CONSTRAINT "ascent_status_shape_check" CHECK (
        ("ascent"."status" IN ('dns', 'dnf', 'dsq') AND "ascent"."hold_number" IS NULL AND "ascent"."is_top" = false)
        OR ("ascent"."status" = 'valid' AND "ascent"."is_top" = true)
        OR (
          "ascent"."status" = 'valid' AND "ascent"."is_top" = false
          AND "ascent"."hold_number" IS NOT NULL
          AND "ascent"."hold_number" >= 1 AND "ascent"."hold_number" <= "ascent"."hold_count"
        )
      )
);
--> statement-breakpoint
CREATE TABLE "ascent_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ascent_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"payload" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"kind" text DEFAULT 'video' NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"uploaded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_kind_check" CHECK ("asset"."kind" IN ('video'))
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sex" text NOT NULL,
	"birth_year_min" integer,
	"birth_year_max" integer,
	"display_order" integer NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_sex_check" CHECK ("category"."sex" IN ('M', 'F', 'X'))
);
--> statement-breakpoint
CREATE TABLE "club" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "competition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"name" text NOT NULL,
	"venue" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"discipline" text DEFAULT 'difficulty' NOT NULL,
	"format" text NOT NULL,
	"scoring_engine_id" text NOT NULL,
	"scoring_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_slug" text NOT NULL,
	"timing_enabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_public_slug_unique" UNIQUE("public_slug"),
	CONSTRAINT "competition_format_check" CHECK ("competition"."format" IN ('contest', 'phases')),
	CONSTRAINT "competition_status_check" CHECK ("competition"."status" IN ('draft', 'open', 'running', 'closed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "competitor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"bib" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"birth_year" integer,
	"club_name" text,
	"license_number" text,
	"status" text DEFAULT 'registered' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_status_check" CHECK ("competitor"."status" IN ('registered', 'present', 'withdrawn', 'disqualified'))
);
--> statement-breakpoint
CREATE TABLE "judge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_token_prefix" text NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judge_route" (
	"judge_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_route_judge_id_route_id_pk" PRIMARY KEY("judge_id","route_id")
);
--> statement-breakpoint
CREATE TABLE "round" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"type" text NOT NULL,
	"style" text NOT NULL,
	"display_order" integer NOT NULL,
	"qualifying_count" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_type_check" CHECK ("round"."type" IN ('qualification', 'semifinal', 'final')),
	CONSTRAINT "round_style_check" CHECK ("round"."style" IN ('flash', 'onsight')),
	CONSTRAINT "round_status_check" CHECK ("round"."status" IN ('draft', 'open', 'closed', 'published'))
);
--> statement-breakpoint
CREATE TABLE "round_route" (
	"round_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_route_round_id_route_id_category_id_pk" PRIMARY KEY("round_id","route_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "route" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"hold_count" integer NOT NULL,
	"sector" text,
	"color" text,
	"video_url" text,
	"video_asset_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_hold_count_check" CHECK ("route"."hold_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "route_category" (
	"route_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_category_route_id_category_id_pk" PRIMARY KEY("route_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"role" text NOT NULL,
	"last_login_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"invited_by_user_id" uuid,
	"pending_token_hash" text,
	"pending_token_purpose" text,
	"pending_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_role_check" CHECK ("user"."role" IN ('owner', 'organizer')),
	CONSTRAINT "user_pending_token_purpose_check" CHECK ("user"."pending_token_purpose" IS NULL OR "user"."pending_token_purpose" IN ('email_verification', 'invitation'))
);
--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_recorded_by_judge_id_judge_id_fk" FOREIGN KEY ("recorded_by_judge_id") REFERENCES "public"."judge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_recorded_by_user_id_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_superseded_by_ascent_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."ascent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ascent_event" ADD CONSTRAINT "ascent_event_ascent_id_ascent_id_fk" FOREIGN KEY ("ascent_id") REFERENCES "public"."ascent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition" ADD CONSTRAINT "competition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge" ADD CONSTRAINT "judge_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_route" ADD CONSTRAINT "judge_route_judge_id_judge_id_fk" FOREIGN KEY ("judge_id") REFERENCES "public"."judge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_route" ADD CONSTRAINT "judge_route_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round" ADD CONSTRAINT "round_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_route" ADD CONSTRAINT "round_route_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_route" ADD CONSTRAINT "round_route_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_route" ADD CONSTRAINT "round_route_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_competition_id_competition_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route" ADD CONSTRAINT "route_video_asset_id_asset_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."asset"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_category" ADD CONSTRAINT "route_category_route_id_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."route"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_category" ADD CONSTRAINT "route_category_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ascent_active_key" ON "ascent" USING btree ("round_id","route_id","competitor_id") WHERE "ascent"."superseded_by" IS NULL AND "ascent"."conflict_group" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "category_competition_label_key" ON "category" USING btree ("competition_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_competition_bib_key" ON "competitor" USING btree ("competition_id","bib");--> statement-breakpoint
CREATE UNIQUE INDEX "round_competition_display_order_key" ON "round" USING btree ("competition_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "route_competition_number_key" ON "route" USING btree ("competition_id","number");