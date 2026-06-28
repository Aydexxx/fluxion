import { z } from "zod";
import { API_SCOPES } from "../services/apiKeys";

/** POST /workspaces/:id/api-keys — name + the scopes the key may exercise. */
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Select at least one scope"),
});

export const apiKeyParamsSchema = z.object({
  id: z.string().min(1, "workspace id is required"),
  keyId: z.string().min(1, "key id is required"),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
