import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  // bcrypt only considers the first 72 bytes of the input.
  password: z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const preferencesSchema = z
  .object({
    defaultLanding: z.enum(["workflows", "templates", "runs", "analytics"]).optional(),
  })
  .strict();

/** PATCH /auth/profile — display name and/or preferences (email is immutable). */
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100, "Name is too long").optional(),
    preferences: preferencesSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.preferences !== undefined, { message: "Nothing to update" });

/** POST /auth/password — current + new password. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long"),
});

/** PUT /auth/avatar — a base64 image data URL (cropped client-side). */
export const updateAvatarSchema = z.object({
  avatarUrl: z.string().min(1, "Avatar is required").max(1_500_000, "Avatar image is too large"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateAvatarInput = z.infer<typeof updateAvatarSchema>;
