# System administrator API

System-administrator accounts are separate from ordinary users and business memberships. For the initial production administrator and subscription catalog, use `npm run db:setup:production` with the guarded bootstrap environment described in the [Runflare guide](runflare-deployment.md). This activates a full-access system administrator without creating a business user. In development use `npm run admin:create -- --phone 09123456789 --name "نام مدیر"`; for an additional production administrator use `npm run admin:create:prod -- --phone 09123456789 --name "نام مدیر"`. These CLIs need the application database URL; do not expose it in shared logs or terminal recordings.

## Sign-in and routes

All paths below are prefixed with `/api/v1`.

| Route | Access | Result |
|---|---|---|
| `POST /system-admin/auth/otp/request` | Public; generic response | Requests OTP for an active system-admin phone |
| `POST /system-admin/auth/otp/verify` | Public | Verifies OTP and sets isolated HttpOnly session and readable CSRF cookies |
| `GET /system-admin/session` | Admin session | Returns the current admin's safe profile |
| `GET /system-admin/overview` | Admin session | Returns total businesses, active branches, active users and active admins |
| `GET /system-admin/businesses?q=&cursor=&limit=` | Admin session | Searches and cursor-pages business summaries; includes at most 100 branch previews and no member phone numbers |
| `GET /system-admin/audit?cursor=&limit=` | Admin session | Cursor-pages system-administrator access events |
| `POST /system-admin/auth/logout` | Admin session + CSRF | Revokes the current admin session and clears its cookies |

The `limit` query is clamped to 100. A cursor is a UUID from the prior page; start a new search without the prior cursor. Business summaries do not include member contact data or financial records. Each overview, business-list and audit-list read writes a metadata-only event to `system_admin_audit_events`; audit writes are required for the corresponding read to succeed. Request IDs and result counts are recorded, while search text and session/CSRF values are excluded.

Admin routes authenticate only `shopro_admin_session`; ordinary user sessions do not grant system-wide access. Mutating API calls require `shopro_admin_csrf` to match `X-CSRF-Token` and the hash stored with the active session. System-admin listing is read-only for now; business data and member access cannot be edited from this API.

## Scope and operations

This is a minimal authenticated operations API, not a graphical admin console. It does not expose cross-tenant ledger rows, member phone numbers, session tokens, OTP challenges or file contents. The business API remains responsible for all tenant-level membership and financial mutations. Audit-event retention/alerting and an admin UI are not configured. Provision admin accounts through an operator shell and secure the host/database credentials separately.
