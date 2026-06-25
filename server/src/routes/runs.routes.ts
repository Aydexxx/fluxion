import { Router } from "express";
import { getRunById, getRunLogsController, listRunsController, replayRunController } from "../controllers/runs.controller";
import { requireAuth } from "../middleware/auth";
import { validateParams, validateQuery } from "../middleware/validate";
import { listWorkspaceRunsQuerySchema, runIdParamSchema, runLogsQuerySchema } from "../validation/run.schemas";

const router = Router();

router.get("/", requireAuth, validateQuery(listWorkspaceRunsQuerySchema), listRunsController);
router.get("/:id", requireAuth, validateParams(runIdParamSchema), getRunById);
router.get("/:id/logs", requireAuth, validateParams(runIdParamSchema), validateQuery(runLogsQuerySchema), getRunLogsController);
router.post("/:id/replay", requireAuth, validateParams(runIdParamSchema), replayRunController);

export default router;
