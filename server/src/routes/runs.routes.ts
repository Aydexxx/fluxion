import { Router } from "express";
import { getRunById } from "../controllers/runs.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/:id", requireAuth, getRunById);

export default router;
