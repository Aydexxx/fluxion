import { Router } from "express";
import { env } from "../config/env";
import { requireApiKey, requireScope } from "../middleware/apiKeyAuth";
import { createRateLimiter } from "../middleware/rateLimit";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import {
  apiGetRun,
  apiGetWorkflow,
  apiListRuns,
  apiListWorkflows,
  apiTriggerRun,
} from "../controllers/publicApi.controller";
import {
  listPublicRunsQuerySchema,
  publicRunIdParamSchema,
  publicWorkflowIdParamSchema,
  triggerRunSchema,
} from "../validation/publicApi.schemas";

/**
 * The public REST API, mounted at `/api/v1`. Authenticated by an API key
 * (X-API-Key header), not a user session — entirely separate from the app's
 * `Authorization: Bearer` JWT routes. Key auth runs first, then a per-key rate
 * limit, then scope checks gate each endpoint. Every handler is scoped to the
 * key's workspace, so a key can only ever see its own tenant's data.
 */
const router = Router();

// Authenticate every request before anything else (the limiter keys off the
// resolved key id, so it must run after auth).
router.use(requireApiKey);

// Per-key rate limit. Disabled under test like the other limiters (see
// env.rateLimit); the keyed limiter is exercised directly in its own test.
if (env.rateLimit.enabled) {
  router.use(
    createRateLimiter({
      windowMs: env.rateLimit.publicApiWindowMs,
      max: env.rateLimit.publicApiMax,
      message: "API rate limit exceeded for this key",
      keyGenerator: (req) => req.apiKey?.id ?? "anonymous",
    }),
  );
}

const READ = requireScope("workflows:read");
const RUN = requireScope("workflows:run");

router.get("/workflows", READ, apiListWorkflows);
router.get("/workflows/:id", READ, validateParams(publicWorkflowIdParamSchema), apiGetWorkflow);
router.post(
  "/workflows/:id/runs",
  RUN,
  validateParams(publicWorkflowIdParamSchema),
  validateBody(triggerRunSchema),
  apiTriggerRun,
);
router.get("/runs", READ, validateQuery(listPublicRunsQuerySchema), apiListRuns);
router.get("/runs/:id", READ, validateParams(publicRunIdParamSchema), apiGetRun);

export default router;
