import { Router } from "express";
import {
  createWorkspace,
  deleteWorkspace,
  getAuditLog,
  inviteMember,
  listMembers,
  listWorkspaces,
  removeMember,
  resendInvite,
  revokeInvite,
  updateMemberRole,
} from "../controllers/workspaces.controller";
import { createFolder, deleteFolder, listFolders, renameFolder } from "../controllers/folders.controller";
import { listWorkspaceTags } from "../controllers/tags.controller";
import { createWorkspaceApiKey, listWorkspaceApiKeys, revokeWorkspaceApiKey } from "../controllers/apiKeys.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  auditLogQuerySchema,
  createWorkspaceSchema,
  inviteParamsSchema,
  inviteSchema,
  memberParamsSchema,
  updateMemberRoleSchema,
  workspaceIdParamSchema,
} from "../validation/workspace.schemas";
import { createFolderSchema, folderParamsSchema, renameFolderSchema } from "../validation/folder.schemas";
import { apiKeyParamsSchema, createApiKeySchema } from "../validation/apiKey.schemas";

const router = Router();

router.get("/", requireAuth, listWorkspaces);
router.post("/", requireAuth, validateBody(createWorkspaceSchema), createWorkspace);
router.delete("/:id", requireAuth, validateParams(workspaceIdParamSchema), deleteWorkspace);

// Membership management — server-side RBAC is enforced inside each service.
router.get("/:id/members", requireAuth, validateParams(workspaceIdParamSchema), listMembers);
router.patch(
  "/:id/members/:userId",
  requireAuth,
  validateParams(memberParamsSchema),
  validateBody(updateMemberRoleSchema),
  updateMemberRole,
);
router.delete("/:id/members/:userId", requireAuth, validateParams(memberParamsSchema), removeMember);

// Audit log — admin/owner only (RBAC enforced inside the service).
router.get(
  "/:id/audit-log",
  requireAuth,
  validateParams(workspaceIdParamSchema),
  validateQuery(auditLogQuerySchema),
  getAuditLog,
);

router.post("/:id/invites", requireAuth, validateParams(workspaceIdParamSchema), validateBody(inviteSchema), inviteMember);
router.post("/:id/invites/:inviteId/resend", requireAuth, validateParams(inviteParamsSchema), resendInvite);
router.delete("/:id/invites/:inviteId", requireAuth, validateParams(inviteParamsSchema), revokeInvite);

// Folders — flat, per-workspace groupings of workflows (RBAC enforced inside the service).
router.get("/:id/folders", requireAuth, validateParams(workspaceIdParamSchema), listFolders);
router.post("/:id/folders", requireAuth, validateParams(workspaceIdParamSchema), validateBody(createFolderSchema), createFolder);
router.patch(
  "/:id/folders/:folderId",
  requireAuth,
  validateParams(folderParamsSchema),
  validateBody(renameFolderSchema),
  renameFolder,
);
router.delete("/:id/folders/:folderId", requireAuth, validateParams(folderParamsSchema), deleteFolder);

// Tags — read-only listing for filter/autocomplete UI; tags themselves are
// created/pruned implicitly when assigned to/removed from workflows.
router.get("/:id/tags", requireAuth, validateParams(workspaceIdParamSchema), listWorkspaceTags);

// API keys — programmatic access to the public /api/v1 surface (admin-tier,
// RBAC enforced inside the service). The plaintext is returned once, on create.
router.get("/:id/api-keys", requireAuth, validateParams(workspaceIdParamSchema), listWorkspaceApiKeys);
router.post(
  "/:id/api-keys",
  requireAuth,
  validateParams(workspaceIdParamSchema),
  validateBody(createApiKeySchema),
  createWorkspaceApiKey,
);
router.delete("/:id/api-keys/:keyId", requireAuth, validateParams(apiKeyParamsSchema), revokeWorkspaceApiKey);

export default router;
