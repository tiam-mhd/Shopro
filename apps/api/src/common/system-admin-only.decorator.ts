import { SetMetadata } from "@nestjs/common";

export const SYSTEM_ADMIN_ONLY = "shopro:system-admin-only";

export const SystemAdminOnly = () => SetMetadata(SYSTEM_ADMIN_ONLY, true);
