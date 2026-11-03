# Business member role matrix

This matrix records the API permissions enforced by the current backend. It is a server policy; hiding a button in the web app does not grant or deny access. Every request also requires an active session, active business membership, and an assigned active branch when the route is branch-scoped.

Roles are `OWNER`, `MANAGER`, `ACCOUNTANT`, `CASHIER`, and `VIEWER`. System administrators use a separate session and API described in [system-admin.md](system-admin.md); they are not business members.

## Operational access

| Capability | OWNER | MANAGER | ACCOUNTANT | CASHIER | VIEWER | Backend rule |
|---|---:|---:|---:|---:|---:|---|
| Read scoped product, party, sales, purchase, expense, inventory, and finance records | Yes | Yes | Yes | Yes | Yes | Active member/session and tenant/branch scoping; read routes generally have no additional role check. |
| Read dashboard, profit/loss, cash-flow, receivable/payable, and inventory reports | Yes | Yes | Yes | No | No | `ReportsService.requireReportRole`. |
| Read trial balance | Yes | No | Yes | No | No | Explicit owner/accountant gate. |
| Read member list | Yes | Yes | Yes | Yes | Yes | Active business member; owner sees all member phone numbers, others see their own number and masked numbers for other members. |
| Read member history or business audit events | Yes | No | No | No | No | Owner-only. Audit response contains event metadata, not before/after payloads. |
| Create a business during onboarding | Yes | Yes | Yes | Yes | Yes | Any signed-in user may create a business and becomes its owner. |
| Update business settings or create a branch | Yes | Yes | No | No | No | Owner/manager gate. |
| Add members, change roles/branches, suspend or reactivate a member | Yes | No | No | No | No | Owner-only; owner transfer is a separate unsupported workflow. |

## Mutations

| Mutation | OWNER | MANAGER | ACCOUNTANT | CASHIER | VIEWER | Backend rule |
|---|---:|---:|---:|---:|---:|---|
| Create or update products, categories, and visible-unit settings | Yes | Yes | Yes | No | No | Product service allowlist is owner/manager/accountant. |
| Create a party | Yes | Yes | Yes | Yes | No | Cashier may create a customer/supplier record for an operational transaction. |
| Update or archive a party | Yes | Yes | Yes | No | No | Owner/manager/accountant gate. |
| Create/edit/post a sales draft | Yes | Yes | Yes | Yes | No | Cashier must use catalog price and cannot apply a discount. |
| Return or void a posted sale | Yes | Yes | Yes | No | No | Owner/manager/accountant gate plus idempotency key. |
| Create/edit/post/void a purchase | Yes | Yes | Yes | No | No | Owner/manager/accountant gate. |
| Create/edit/post/void an expense; manage its receipt attachment | Yes | Yes | Yes | No | No | Owner/manager/accountant gate. |
| Create/edit/post/delete a stock count | Yes | Yes | Yes | No | No | Owner/manager/accountant gate. |
| Manage finance accounts, post/void cash transactions, transfers, and cash closes | Yes | Yes | Yes | No | No | Owner/manager/accountant gate. |
| Close or reopen an accounting period | Yes | No | Yes | No | No | Owner/accountant gate. |

## Field-level controls

- Cashiers cannot create or update products. Direct product mutations that include cost, tax, price, SKU, barcode, category, unit, stock policy, or archive fields are rejected by the API.
- Cashier sales may use the product's catalog price only and cannot include a discount. Client-submitted alternative prices are rejected server-side.
- Non-owner member listings mask other members' phone numbers. Member history, role changes, business audit, and membership status changes are owner-only.
- `VIEWER` is read-only. It cannot create a business-scoped record mutation after membership is established.

## Verification status

PostgreSQL-backed HTTP integration proves cashier cost-update denial with no product mutation; tenant and branch isolation; member phone masking; owner-only member-history, role-change, and business-audit routes; cashier report denial; CSRF rejection; UUID validation; and owner product creation. Service tests cover the broader owner/member management policy. The full role × endpoint × field matrix is not yet exercised over HTTP: manager/accountant allow paths, every mutation route, and all viewer data scopes still need acceptance coverage before this matrix is treated as a complete release gate.
