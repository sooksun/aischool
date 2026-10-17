-- FR-099 / CCR-022: one-time password resets a school admin issues. Only the
-- token's hash is stored; a row is spent (used_at) or cancelled by a newer one.
CREATE TABLE "password_reset" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_by_user_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_lifetime_check" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + INTERVAL '30 minutes')
);

CREATE UNIQUE INDEX "password_reset_token_hash_key" ON "password_reset"("token_hash");
CREATE INDEX "password_reset_user_id_used_at_idx" ON "password_reset"("user_id", "used_at");

ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "user_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;
