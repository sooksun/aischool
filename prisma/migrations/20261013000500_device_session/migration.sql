-- FR-093 / ADR-0014 §5: one row per app sign-in (a Keycloak offline session of
-- seip-mobile), so a person can list their devices and revoke one. Web sessions
-- are listed from web_session.
CREATE TABLE "device_session" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kc_session_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "device_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_session_platform_check" CHECK ("platform" IN ('android', 'ios'))
);

CREATE UNIQUE INDEX "device_session_kc_session_id_key" ON "device_session"("kc_session_id");
CREATE INDEX "device_session_user_id_revoked_at_idx" ON "device_session"("user_id", "revoked_at");

ALTER TABLE "device_session" ADD CONSTRAINT "device_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
