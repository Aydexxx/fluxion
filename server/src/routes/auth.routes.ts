import { Router, json } from "express";
import {
  changePasswordController,
  deleteAvatarController,
  login,
  me,
  register,
  updateAvatarController,
  updateProfileController,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateAvatarSchema,
  updateProfileSchema,
} from "../validation/auth.schemas";

const router = Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.get("/me", requireAuth, me);

router.patch("/profile", requireAuth, validateBody(updateProfileSchema), updateProfileController);
router.post("/password", requireAuth, validateBody(changePasswordSchema), changePasswordController);

// Avatar payloads (base64 image data URLs) exceed the default body limit, so this
// route gets its own larger JSON parser.
router.put("/avatar", requireAuth, json({ limit: "2mb" }), validateBody(updateAvatarSchema), updateAvatarController);
router.delete("/avatar", requireAuth, deleteAvatarController);

export default router;
