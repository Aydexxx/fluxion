import { Router } from "express";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
  updateWorkflow,
} from "../controllers/workflows.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createWorkflowSchema,
  listWorkflowsQuerySchema,
  runWorkflowSchema,
  updateWorkflowSchema,
} from "../validation/workflow.schemas";

const router = Router();

router.post("/", requireAuth, validateBody(createWorkflowSchema), createWorkflow);
router.get("/", requireAuth, validateQuery(listWorkflowsQuerySchema), listWorkflows);
router.get("/:id", requireAuth, getWorkflow);
router.put("/:id", requireAuth, validateBody(updateWorkflowSchema), updateWorkflow);
router.delete("/:id", requireAuth, deleteWorkflow);
router.post("/:id/run", requireAuth, validateBody(runWorkflowSchema), runWorkflow);
router.get("/:id/runs", requireAuth, listWorkflowRuns);

export default router;
