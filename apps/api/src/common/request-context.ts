import type { Request } from "express";
import type { MemberRole } from "@shopro/contracts";

export interface AuthenticatedUser {
  id: string;
  phone: string;
  displayName: string | null;
  sessionId: string;
  csrfHash: string;
  businessId?: string;
  branchId?: string;
  memberId?: string;
  role?: MemberRole;
  branchIds?: string[];
}

export interface AuthenticatedSystemAdmin {
  id: string;
  username: string;
  displayName: string;
  sessionId: string;
  csrfHash: string;
}

export type AppRequest = Request & {
  user?: AuthenticatedUser;
  systemAdmin?: AuthenticatedSystemAdmin;
  requestId?: string;
};
