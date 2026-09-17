ALTER TABLE "competition" ADD COLUMN "judge_credentials_stored" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "judge" ADD COLUMN "access_token_plain" text;--> statement-breakpoint
ALTER TABLE "judge" ADD COLUMN "pin_plain" text;