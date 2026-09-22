-- ADR-078 : retour sans `ascent.voided_at`. PERTE ASSUMÉE : la marque « refusée »
-- disparaît. Une saisie refusée garde son `conflict_group` ; après ce down elle
-- réapparaît donc comme une saisie à valider dans l'onglet Conflits (et bloque de
-- nouveau la publication) — elle ne rentre JAMAIS au classement par ce down.
ALTER TABLE "ascent" DROP COLUMN "voided_at";
