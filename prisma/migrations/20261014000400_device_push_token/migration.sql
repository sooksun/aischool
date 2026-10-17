-- FR-100: a push token per app sign-in (device_session); the ping carries no content (FR-101).
-- AlterTable
ALTER TABLE "device_session" ADD COLUMN     "push_provider" TEXT,
ADD COLUMN     "push_token" TEXT;

ALTER TABLE "device_session" ADD CONSTRAINT "device_session_push_provider_ck" CHECK (push_provider IS NULL OR push_provider IN ('fcm', 'apns'));

