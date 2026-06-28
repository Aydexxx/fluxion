import { Router } from "express";
import {
  createWorkspaceTemplateController,
  deleteWorkspaceTemplateController,
  instantiateTemplateController,
  instantiateWorkspaceTemplateController,
  listTemplatesController,
  listWorkspaceTemplatesController,
  updateWorkspaceTemplateController,
} from "../controllers/templates.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createWorkspaceTemplateSchema,
  instantiateTemplateSchema,
  instantiateWorkspaceTemplateSchema,
  listWorkspaceTemplatesSchema,
  updateWorkspaceTemplateSchema,
} from "../validation/template.schemas";

const router = Router();

// User-created, workspace-scoped templates. Declared before the built-in
// `/:id/instantiate` route so "custom" is never captured as a template id.
router.get("/custom", requireAuth, validateQuery(listWorkspaceTemplatesSchema), listWorkspaceTemplatesController);
router.post("/custom", requireAuth, validateBody(createWorkspaceTemplateSchema), createWorkspaceTemplateController);
router.patch(
  "/custom/:id",
  requireAuth,
  validateBody(updateWorkspaceTemplateSchema),
  updateWorkspaceTemplateController,
);
router.delete("/custom/:id", requireAuth, deleteWorkspaceTemplateController);
router.post(
  "/custom/:id/instantiate",
  requireAuth,
  validateBody(instantiateWorkspaceTemplateSchema),
  instantiateWorkspaceTemplateController,
);

// Built-in catalog.
router.get("/", requireAuth, listTemplatesController);
router.post("/:id/instantiate", requireAuth, validateBody(instantiateTemplateSchema), instantiateTemplateController);

export default router;
