import { Router } from "express";
import { listWorkspaces } from "../controllers/workspaces.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, listWorkspaces);

export default router;
