-- Additive-only: adds refresh_token, backing the TokenPair.refresh_token contract
-- field and SEC-AUTH-2 (rotation + reuse detection). No existing table changes.
--
-- NOTE: `prisma migrate dev` initially generated a spurious leading statement
-- (`ALTER TABLE round_result ALTER COLUMN passed_individual_threshold DROP DEFAULT`)
-- because Prisma's schema does not know that column is GENERATED ALWAYS AS ... STORED
-- (added by the hand-written 20260716234600_constraints migration — Prisma's schema
-- language cannot express generated columns, so its diff engine misreads one as having
-- a plain default and tries to "fix" it). That statement was removed by hand: it does
-- not correspond to any change in schema.prisma and running it against Postgres errors
-- with "column ... is a generated column" (confirmed — the auto-apply failed on this
-- exact statement, table below was never created, real dev DB was untouched). Same
-- class of limitation already documented in the DB-001 CI job comment.

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by_id" UUID,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_revoked_at_idx" ON "refresh_token"("user_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
