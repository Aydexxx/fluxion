import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { createApiKey, listApiKeys, revokeApiKey, type CreatedApiKey, type SafeApiKey } from "../services/apiKeys";
import type { CreateApiKeyInput } from "../validation/apiKey.schemas";

/** GET /workspaces/:id/api-keys — active keys for the workspace (admin-tier). */
export async function listWorkspaceApiKeys(req: Request<{ id: string }>, res: Response<SafeApiKey[]>): Promise<void> {
  const keys = await listApiKeys(req.params.id, currentUserId(req));
  res.json(keys);
}

/** POST /workspaces/:id/api-keys — create a key; the plaintext is returned once here. */
export async function createWorkspaceApiKey(
  req: Request<{ id: string }, unknown, CreateApiKeyInput>,
  res: Response<CreatedApiKey>,
): Promise<void> {
  const key = await createApiKey(req.params.id, currentUserId(req), req.body);
  res.status(201).json(key);
}

/** DELETE /workspaces/:id/api-keys/:keyId — revoke a key. */
export async function revokeWorkspaceApiKey(req: Request<{ id: string; keyId: string }>, res: Response): Promise<void> {
  await revokeApiKey(req.params.keyId, currentUserId(req));
  res.status(204).end();
}
