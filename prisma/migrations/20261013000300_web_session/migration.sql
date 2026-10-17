-- CCR-018 / ADR-0014 §4: browser sessions behind the BFF.
CREATE TABLE "web_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "acr" INTEGER NOT NULL,
    "kc_session_id" TEXT,
    "kc_refresh_token" TEXT NOT NULL,
    "kc_check_due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "web_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "web_session_acr_check" CHECK ("acr" BETWEEN 0 AND 2),
    CONSTRAINT "web_session_lifetime_check" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "web_session_token_hash_key" ON "web_session"("token_hash");
CREATE INDEX "web_session_user_id_revoked_at_idx" ON "web_session"("user_id", "revoked_at");

ALTER TABLE "web_session" ADD CONSTRAINT "web_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
