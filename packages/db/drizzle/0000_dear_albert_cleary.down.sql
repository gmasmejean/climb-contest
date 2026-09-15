-- Down migration écrite à la main pour 0000_dear_albert_cleary.sql — voir
-- ADR-018 (DECISIONS.md) : drizzle-kit ne génère pas de migration "down".
DROP TABLE IF EXISTS "ascent_event" CASCADE;
DROP TABLE IF EXISTS "ascent" CASCADE;
DROP TABLE IF EXISTS "asset" CASCADE;
DROP TABLE IF EXISTS "judge_route" CASCADE;
DROP TABLE IF EXISTS "judge" CASCADE;
DROP TABLE IF EXISTS "round_route" CASCADE;
DROP TABLE IF EXISTS "round" CASCADE;
DROP TABLE IF EXISTS "route_category" CASCADE;
DROP TABLE IF EXISTS "route" CASCADE;
DROP TABLE IF EXISTS "competitor" CASCADE;
DROP TABLE IF EXISTS "category" CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;
DROP TABLE IF EXISTS "competition" CASCADE;
DROP TABLE IF EXISTS "club" CASCADE;
