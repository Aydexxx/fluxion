import { z } from "zod";
import { hasAtLeastOneField } from "./util";

/** Field values are always strings; the service validates them against the type's catalog spec. */
const credentialDataSchema = z.record(z.string(), z.string());

export const createCredentialSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  name: z.string().trim().min(1, "Name is required").max(150, "Name is too long"),
  type: z.string().min(1, "type is required"),
  data: credentialDataSchema.default({}),
});

export const updateCredentialSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150, "Name is too long").optional(),
    data: credentialDataSchema.optional(),
  })
  .refine(hasAtLeastOneField, { message: "At least one field must be provided" });

export const listCredentialsQuerySchema = z.object({
  workspaceId: z.string().min(1, "workspaceId query parameter is required"),
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
export type ListCredentialsQuery = z.infer<typeof listCredentialsQuerySchema>;
