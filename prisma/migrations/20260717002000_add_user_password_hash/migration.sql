-- Additive-only: SEIP-API-001 discovered UserAccount had no way to store
-- credentials (DB-000/DB-001 scoped the evaluation domain, not auth). Nullable —
-- an `invited` account has none yet; a future SSO account may never have one.
-- Hand-written rather than `prisma migrate dev` because the shadow-database diff
-- workflow was blocked by an unrelated checksum mismatch on a prior migration
-- (see 20260717001157_add_refresh_token's own header comment for that history);
-- a single nullable column addition is simple enough to author directly with the
-- same confidence as the generated migrations.

ALTER TABLE "user_account" ADD COLUMN "password_hash" TEXT;
