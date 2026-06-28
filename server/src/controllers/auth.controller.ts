import type { Request, Response } from "express";
import type { ApiError } from "../types/api";
import type { SafeUser } from "../services/users";
import type { SafeWorkspaceWithRole } from "../services/workspaces";
import { prisma } from "../services/prisma";
import { hashPassword, verifyPassword } from "../services/password";
import { signAccessToken } from "../services/jwt";
import { toSafeUser } from "../services/users";
import { changePassword, removeAvatar, setAvatar, updateProfile } from "../services/profile";
import { createDefaultWorkspace } from "../services/workspaces";
import { currentUserId } from "../middleware/auth";
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  UpdateAvatarInput,
  UpdateProfileInput,
} from "../validation/auth.schemas";

interface AuthResponse {
  token: string;
  user: SafeUser;
  workspace: SafeWorkspaceWithRole;
}

/** POST /auth/register -> create a user + default workspace, return a token. */
export async function register(
  req: Request<unknown, unknown, RegisterInput>,
  res: Response<AuthResponse | ApiError>,
): Promise<void> {
  const { name, email, password } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: { message: "Email is already registered", code: "EMAIL_TAKEN" } });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });
  const workspace = await createDefaultWorkspace(user.id, user.name);

  const token = signAccessToken(user.id);
  res.status(201).json({ token, user: toSafeUser(user), workspace });
}

/** POST /auth/login -> verify credentials and return a token. */
export async function login(
  req: Request<unknown, unknown, LoginInput>,
  res: Response<Omit<AuthResponse, "workspace"> | ApiError>,
): Promise<void> {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordMatches) {
    res.status(401).json({ error: { message: "Invalid email or password", code: "INVALID_CREDENTIALS" } });
    return;
  }

  const token = signAccessToken(user.id);
  res.json({ token, user: toSafeUser(user) });
}

/** GET /auth/me -> the current authenticated user (requires `requireAuth`). */
export async function me(req: Request, res: Response<SafeUser | ApiError>): Promise<void> {
  // requireAuth has already run and guarantees req.user is set here.
  const authUser = req.user as NonNullable<typeof req.user>;

  const user = await prisma.user.findUnique({ where: { id: authUser.id } });
  if (!user) {
    res.status(404).json({ error: { message: "User not found", code: "NOT_FOUND" } });
    return;
  }
  res.json(toSafeUser(user));
}

/** PATCH /auth/profile -> update display name and/or preferences. */
export async function updateProfileController(
  req: Request<unknown, unknown, UpdateProfileInput>,
  res: Response<SafeUser>,
): Promise<void> {
  res.json(await updateProfile(currentUserId(req), req.body));
}

/** POST /auth/password -> change password after verifying the current one. */
export async function changePasswordController(
  req: Request<unknown, unknown, ChangePasswordInput>,
  res: Response,
): Promise<void> {
  await changePassword(currentUserId(req), req.body);
  res.status(204).end();
}

/** PUT /auth/avatar -> store a cropped avatar image. */
export async function updateAvatarController(
  req: Request<unknown, unknown, UpdateAvatarInput>,
  res: Response<SafeUser>,
): Promise<void> {
  res.json(await setAvatar(currentUserId(req), req.body.avatarUrl));
}

/** DELETE /auth/avatar -> revert to initials. */
export async function deleteAvatarController(req: Request, res: Response<SafeUser>): Promise<void> {
  res.json(await removeAvatar(currentUserId(req)));
}
