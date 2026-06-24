import { Router } from "express";
import {
  createCredential,
  deleteCredential,
  listCredentialTypes,
  listCredentials,
  updateCredential,
} from "../controllers/credentials.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody, validateQuery } from "../middleware/validate";
import {
  createCredentialSchema,
  listCredentialsQuerySchema,
  updateCredentialSchema,
} from "../validation/credential.schemas";

const router = Router();

// Static type catalog (no workspace context needed) — declared before /:id routes.
router.get("/types", requireAuth, listCredentialTypes);

router.get("/", requireAuth, validateQuery(listCredentialsQuerySchema), listCredentials);
router.post("/", requireAuth, validateBody(createCredentialSchema), createCredential);
router.put("/:id", requireAuth, validateBody(updateCredentialSchema), updateCredential);
router.delete("/:id", requireAuth, deleteCredential);

export default router;
