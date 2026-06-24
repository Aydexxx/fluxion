import { Router } from "express";
import { getAnalyticsController } from "../controllers/analytics.controller";
import { requireAuth } from "../middleware/auth";
import { validateQuery } from "../middleware/validate";
import { analyticsQuerySchema } from "../validation/run.schemas";

const router = Router();

router.get("/", requireAuth, validateQuery(analyticsQuerySchema), getAnalyticsController);

export default router;
