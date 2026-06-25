import { Router } from "express";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowRuns,
  listWorkflowVersions,
  listWorkflows,
  publishWorkflow,
  rollbackWorkflow,
  runWorkflow,
  testWorkflowNodeController,
  updateWorkflow,
} from "../controllers/workflows.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createWorkflowSchema,
  listWorkflowsQuerySchema,
  publishWorkflowSchema,
  runWorkflowSchema,
  testNodeSchema,
  updateWorkflowSchema,
} from "../validation/workflow.schemas";

const router = Router();

router.post("/", requireAuth, validateBody(createWorkflowSchema), createWorkflow);
router.get("/", requireAuth, validateQuery(listWorkflowsQuerySchema), listWorkflows);
router.get("/:id", requireAuth, getWorkflow);
router.put("/:id", requireAuth, validateBody(updateWorkflowSchema), updateWorkflow);
router.delete("/:id", requireAuth, deleteWorkflow);
router.post("/:id/publish", requireAuth, validateBody(publishWorkflowSchema), publishWorkflow);
router.get("/:id/versions", requireAuth, listWorkflowVersions);
router.get("/:id/versions/:versionId", requireAuth, getWorkflowVersion);
router.post("/:id/versions/:versionId/rollback", requireAuth, rollbackWorkflow);
router.post("/:id/run", requireAuth, validateBody(runWorkflowSchema), runWorkflow);
router.get("/:id/runs", requireAuth, listWorkflowRuns);
router.post("/:id/nodes/:nodeId/test", requireAuth, validateBody(testNodeSchema), testWorkflowNodeController);

export default router;
