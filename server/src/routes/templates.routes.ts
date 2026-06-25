import { Router } from "express";
import { instantiateTemplateController, listTemplatesController } from "../controllers/templates.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { instantiateTemplateSchema } from "../validation/template.schemas";

const router = Router();

router.get("/", requireAuth, listTemplatesController);
router.post("/:id/instantiate", requireAuth, validateBody(instantiateTemplateSchema), instantiateTemplateController);

export default router;
