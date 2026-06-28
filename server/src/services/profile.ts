import { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./password";
import { NotFoundError, ValidationError } from "../errors/HttpError";
import { parsePreferences, toSafeUser, type SafeUser, type UserPreferences } from "./users";

async function loadUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export interface UpdateProfileInput {
  name?: string;
  preferences?: UserPreferences;
}

/** Update the user's display name and/or preferences. Email is immutable here. */
export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<SafeUser> {
  const existing = await loadUser(userId);

  // Preferences are merged (a partial update doesn't wipe unspecified keys).
  const preferences =
    input.preferences === undefined
      ? undefined
      : ({ ...parsePreferences(existing.preferences), ...parsePreferences(input.preferences) } as Prisma.InputJsonValue);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      name: input.name?.trim() || undefined,
      preferences,
    },
  });
  return toSafeUser(user);
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Change the user's password after verifying the current one. The new hash uses
 * the same bcrypt cost as registration. A wrong current password is a 400 (never
 * 401 — that would trip the client's auto-logout).
 */
export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await loadUser(userId);

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw new ValidationError("Current password is incorrect");

  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw new ValidationError("New password must be different from the current one");
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

/** Max stored avatar payload (~700KB of base64 ≈ a generous 256px image). */
const MAX_AVATAR_CHARS = 700_000;
const AVATAR_DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Store a cropped avatar (a self-contained image data URL). */
export async function setAvatar(userId: string, dataUrl: string): Promise<SafeUser> {
  await loadUser(userId);
  if (!AVATAR_DATA_URL.test(dataUrl)) {
    throw new ValidationError("Avatar must be a base64-encoded PNG, JPEG, WebP, or GIF image");
  }
  if (dataUrl.length > MAX_AVATAR_CHARS) {
    throw new ValidationError("Avatar image is too large — please crop or use a smaller picture");
  }
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: dataUrl } });
  return toSafeUser(user);
}

/** Remove the avatar, reverting to initials. */
export async function removeAvatar(userId: string): Promise<SafeUser> {
  await loadUser(userId);
  const user = await prisma.user.update({ where: { id: userId }, data: { avatarUrl: null } });
  return toSafeUser(user);
}
