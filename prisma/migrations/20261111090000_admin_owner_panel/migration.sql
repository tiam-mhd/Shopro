ALTER TABLE "system_admins"
    ALTER COLUMN "phone" DROP NOT NULL,
    ADD COLUMN "username" VARCHAR(40),
    ADD COLUMN "password_hash" VARCHAR(255),
    ADD COLUMN "password_changed_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "system_admins_username_key" ON "system_admins"("username");

-- Keep the existing administrator identity when exactly one legacy row exists.
-- If multiple rows exist, leave them untouched so application startup fails closed
-- instead of silently choosing an owner or creating another administrator.
DO $$
DECLARE
    legacy_admin_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO legacy_admin_count FROM "system_admins";
    IF legacy_admin_count = 1 THEN
        UPDATE "system_admins"
        SET "username" = 'shopro_super_admin'
        WHERE "username" IS NULL;
    END IF;
END;
$$;

ALTER TABLE "system_admin_sessions"
    ADD COLUMN "absolute_expires_at" TIMESTAMPTZ(6),
    ADD COLUMN "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "ip_hash" CHAR(64),
    ADD COLUMN "user_agent" VARCHAR(500);

UPDATE "system_admin_sessions"
SET "absolute_expires_at" = "expires_at",
    "last_seen_at" = "created_at",
    "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP);

ALTER TABLE "system_admin_sessions"
    ALTER COLUMN "absolute_expires_at" SET NOT NULL,
    ALTER COLUMN "absolute_expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours');

ALTER TABLE "system_admin_audit_events"
    ALTER COLUMN "admin_id" DROP NOT NULL;

ALTER TABLE "system_admin_audit_events"
    DROP CONSTRAINT "system_admin_audit_events_admin_id_fkey";

ALTER TABLE "system_admin_audit_events"
    ADD CONSTRAINT "system_admin_audit_events_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "system_admins"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "system_admin_login_attempts" (
    "fingerprint" CHAR(64) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL,
    "blocked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_admin_login_attempts_pkey" PRIMARY KEY ("fingerprint")
);

CREATE INDEX "system_admin_login_attempts_updated_at_idx"
    ON "system_admin_login_attempts"("updated_at");

CREATE TABLE "system_admin_notes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "note" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_admin_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_admin_notes_entity_type_entity_id_created_at_idx"
    ON "system_admin_notes"("entity_type", "entity_id", "created_at");

ALTER TABLE "system_admin_notes"
    ADD CONSTRAINT "system_admin_notes_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "system_admins"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "businesses"
    ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN "admin_suspended_at" TIMESTAMPTZ(6),
    ADD COLUMN "admin_suspension_reason" VARCHAR(500);

CREATE FUNCTION "prevent_system_admin_audit_event_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'system admin audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "system_admin_audit_events_append_only"
    BEFORE UPDATE OR DELETE ON "system_admin_audit_events"
    FOR EACH ROW EXECUTE FUNCTION "prevent_system_admin_audit_event_mutation"();
