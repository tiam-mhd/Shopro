CREATE TABLE "system_admin_audit_events" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "request_id" VARCHAR(80) NOT NULL,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_admin_audit_events_admin_id_occurred_at_idx"
    ON "system_admin_audit_events"("admin_id", "occurred_at");
CREATE INDEX "system_admin_audit_events_entity_type_entity_id_occurred_at_idx"
    ON "system_admin_audit_events"("entity_type", "entity_id", "occurred_at");

ALTER TABLE "system_admin_audit_events"
    ADD CONSTRAINT "system_admin_audit_events_admin_id_fkey"
    FOREIGN KEY ("admin_id") REFERENCES "system_admins"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
