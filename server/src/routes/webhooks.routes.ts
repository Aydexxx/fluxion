import { Router } from "express";
import { handleWebhook } from "../controllers/webhooks.controller";

const router = Router();

// Public endpoint — the unguessable token is the only credential.
router.post("/:token", handleWebhook);

export default router;
