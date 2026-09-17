ALTER TABLE "competition" DROP COLUMN "judge_pin_required";
ALTER TABLE "judge" ALTER COLUMN "pin_hash" SET NOT NULL;
