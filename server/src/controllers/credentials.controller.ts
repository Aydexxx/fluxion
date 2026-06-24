import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as credentialService from "../services/credentials";
import type { SafeCredential } from "../services/credentials";
import { CREDENTIAL_TYPES, type CredentialTypeSpec } from "../credentials/catalog";
import type {
  CreateCredentialInput,
  ListCredentialsQuery,
  UpdateCredentialInput,
} from "../validation/credential.schemas";

/** GET /credentials/types -> the credential type catalog the management UI renders forms from. */
export function listCredentialTypes(_req: Request, res: Response<CredentialTypeSpec[]>): void {
  res.json(Object.values(CREDENTIAL_TYPES));
}

/** GET /credentials?workspaceId= -> client-safe credential metadata (never secrets). */
export async function listCredentials(
  req: Request<unknown, unknown, unknown, ListCredentialsQuery>,
  res: Response<SafeCredential[]>,
): Promise<void> {
  const credentials = await credentialService.listCredentials(req.query.workspaceId, currentUserId(req));
  res.json(credentials);
}

export async function createCredential(
  req: Request<unknown, unknown, CreateCredentialInput>,
  res: Response<SafeCredential>,
): Promise<void> {
  const credential = await credentialService.createCredential(currentUserId(req), req.body);
  res.status(201).json(credential);
}

export async function updateCredential(
  req: Request<{ id: string }, unknown, UpdateCredentialInput>,
  res: Response<SafeCredential>,
): Promise<void> {
  const credential = await credentialService.updateCredential(req.params.id, currentUserId(req), req.body);
  res.json(credential);
}

export async function deleteCredential(req: Request<{ id: string }>, res: Response): Promise<void> {
  await credentialService.deleteCredential(req.params.id, currentUserId(req));
  res.status(204).end();
}
