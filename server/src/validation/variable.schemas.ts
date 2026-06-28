import { z } from "zod";
import { hasAtLeastOneField } from "./util";

/**
 * Reference keys are identifier-shaped so `{{ vars.KEY }}` / `{{ secrets.KEY }}`
 * parse cleanly through the dotted-path resolver (no dots/spaces in a key).
 */
const keySchema = z
  .string()
  .trim()
  .min(1, "Key is required")
  .max(64, "Key is too long")
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Key must start with a letter or underscore and contain only letters, digits, and underscores");

const valueSchema = z.string().max(10_000, "Value is too long");

export const workspaceIdQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId query parameter is required"),
});

export const createVariableSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  key: keySchema,
  value: valueSchema,
});

export const updateVariableSchema = z
  .object({
    key: keySchema.optional(),
    value: valueSchema.optional(),
  })
  .refine(hasAtLeastOneField, { message: "At least one field must be provided" });

export const createSecretSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  key: keySchema,
  // A secret must have a non-empty value at creation; on update it's optional (rename-only).
  value: valueSchema.min(1, "Value is required"),
});

export const updateSecretSchema = z
  .object({
    key: keySchema.optional(),
    value: valueSchema.min(1, "Value cannot be empty").optional(),
  })
  .refine(hasAtLeastOneField, { message: "At least one field must be provided" });

export type CreateVariableInput = z.infer<typeof createVariableSchema>;
export type UpdateVariableInput = z.infer<typeof updateVariableSchema>;
export type CreateSecretInput = z.infer<typeof createSecretSchema>;
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;
export type WorkspaceIdQuery = z.infer<typeof workspaceIdQuerySchema>;
