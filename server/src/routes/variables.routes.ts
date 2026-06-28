import { Router } from "express";
import {
  createSecret,
  createVariable,
  deleteSecret,
  deleteVariable,
  listSecrets,
  listVariables,
  updateSecret,
  updateVariable,
} from "../controllers/variables.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createSecretSchema,
  createVariableSchema,
  updateSecretSchema,
  updateVariableSchema,
  workspaceIdQuerySchema,
} from "../validation/variable.schemas";

/**
 * Workspace variables + secrets — referenceable in node configs. Modelled on the
 * credentials routes (workspaceId in query/body); RBAC is enforced inside each
 * service (read = member, write = editor, delete = admin).
 */
export const variableRoutes = Router();

variableRoutes.get("/", requireAuth, validateQuery(workspaceIdQuerySchema), listVariables);
variableRoutes.post("/", requireAuth, validateBody(createVariableSchema), createVariable);
variableRoutes.put("/:id", requireAuth, validateBody(updateVariableSchema), updateVariable);
variableRoutes.delete("/:id", requireAuth, deleteVariable);

export const secretRoutes = Router();

secretRoutes.get("/", requireAuth, validateQuery(workspaceIdQuerySchema), listSecrets);
secretRoutes.post("/", requireAuth, validateBody(createSecretSchema), createSecret);
secretRoutes.put("/:id", requireAuth, validateBody(updateSecretSchema), updateSecret);
secretRoutes.delete("/:id", requireAuth, deleteSecret);
