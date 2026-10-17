-- ADR-0014: when the account's Keycloak user was confirmed to exist.
ALTER TABLE "user_account" ADD COLUMN "kc_linked_at" TIMESTAMP(3);
