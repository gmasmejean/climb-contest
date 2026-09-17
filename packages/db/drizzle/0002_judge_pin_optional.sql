ALTER TABLE "judge" ALTER COLUMN "pin_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "competition" ADD COLUMN "judge_pin_required" boolean DEFAULT false NOT NULL;