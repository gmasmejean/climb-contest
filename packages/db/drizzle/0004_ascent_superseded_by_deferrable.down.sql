ALTER TABLE "ascent" DROP CONSTRAINT "ascent_superseded_by_ascent_id_fk";
ALTER TABLE "ascent" ADD CONSTRAINT "ascent_superseded_by_ascent_id_fk"
  FOREIGN KEY ("superseded_by") REFERENCES "ascent"("id");
