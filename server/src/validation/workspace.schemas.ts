import { z } from "zod";

/** Roles an inviter may hand out. `owner` is intentionally excluded — ownership
 *  is conferred by an explicit role change, never a fresh invite. */
export const assignableInviteRoleSchema = z.enum(["admin", "editor", "viewer"]);

/** Every role a member-role change may target (owner included, for promotion/transfer). */
export const memberRoleSchema = z.enum(["owner", "admin", "editor", "viewer"]);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  role: assignableInviteRoleSchema.default("viewer"),
});

export const updateMemberRoleSchema = z.object({
  role: memberRoleSchema,
});

export const workspaceIdParamSchema = z.object({
  id: z.string().min(1, "workspace id is required"),
});

export const memberParamsSchema = z.object({
  id: z.string().min(1, "workspace id is required"),
  userId: z.string().min(1, "user id is required"),
});

export const inviteParamsSchema = z.object({
  id: z.string().min(1, "workspace id is required"),
  inviteId: z.string().min(1, "invite id is required"),
});

export const inviteIdParamSchema = z.object({
  inviteId: z.string().min(1, "invite id is required"),
});

/** Accepts any string parseable as a date, rejecting garbage. */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid date" });

/** GET /workspaces/:id/audit-log — admin-only, filterable + keyset-paginated. */
export const auditLogQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  action: z.string().min(1).max(100).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
