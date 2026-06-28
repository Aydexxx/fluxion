import { Router } from "express";
import { acceptInvite, declineInvite, listMyInvites } from "../controllers/workspaces.controller";
import { requireAuth } from "../middleware/auth";
import { validateParams } from "../middleware/validate";
import { inviteIdParamSchema } from "../validation/workspace.schemas";

const router = Router();

// The invitee's own view of pending invitations addressed to their email.
router.get("/", requireAuth, listMyInvites);
router.post("/:inviteId/accept", requireAuth, validateParams(inviteIdParamSchema), acceptInvite);
router.post("/:inviteId/decline", requireAuth, validateParams(inviteIdParamSchema), declineInvite);

export default router;
