import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import * as variableService from "../services/variables";
import type { SafeSecret, SafeVariable } from "../services/variables";
import type {
  CreateSecretInput,
  CreateVariableInput,
  UpdateSecretInput,
  UpdateVariableInput,
  WorkspaceIdQuery,
} from "../validation/variable.schemas";

/* ── Variables (plain values) ─────────────────────────────────────────────── */

/** GET /variables?workspaceId= -> the workspace's variables (values included). */
export async function listVariables(
  req: Request<unknown, unknown, unknown, WorkspaceIdQuery>,
  res: Response<SafeVariable[]>,
): Promise<void> {
  const variables = await variableService.listVariables(req.query.workspaceId, currentUserId(req));
  res.json(variables);
}

export async function createVariable(
  req: Request<unknown, unknown, CreateVariableInput>,
  res: Response<SafeVariable>,
): Promise<void> {
  const variable = await variableService.createVariable(req.body.workspaceId, currentUserId(req), {
    key: req.body.key,
    value: req.body.value,
  });
  res.status(201).json(variable);
}

export async function updateVariable(
  req: Request<{ id: string }, unknown, UpdateVariableInput>,
  res: Response<SafeVariable>,
): Promise<void> {
  const variable = await variableService.updateVariable(req.params.id, currentUserId(req), req.body);
  res.json(variable);
}

export async function deleteVariable(req: Request<{ id: string }>, res: Response): Promise<void> {
  await variableService.deleteVariable(req.params.id, currentUserId(req));
  res.status(204).end();
}

/* ── Secrets (encrypted; value never returned) ────────────────────────────── */

/** GET /secrets?workspaceId= -> the workspace's secrets by key only (values masked). */
export async function listSecrets(
  req: Request<unknown, unknown, unknown, WorkspaceIdQuery>,
  res: Response<SafeSecret[]>,
): Promise<void> {
  const secrets = await variableService.listSecrets(req.query.workspaceId, currentUserId(req));
  res.json(secrets);
}

export async function createSecret(
  req: Request<unknown, unknown, CreateSecretInput>,
  res: Response<SafeSecret>,
): Promise<void> {
  const secret = await variableService.createSecret(req.body.workspaceId, currentUserId(req), {
    key: req.body.key,
    value: req.body.value,
  });
  res.status(201).json(secret);
}

export async function updateSecret(
  req: Request<{ id: string }, unknown, UpdateSecretInput>,
  res: Response<SafeSecret>,
): Promise<void> {
  const secret = await variableService.updateSecret(req.params.id, currentUserId(req), req.body);
  res.json(secret);
}

export async function deleteSecret(req: Request<{ id: string }>, res: Response): Promise<void> {
  await variableService.deleteSecret(req.params.id, currentUserId(req));
  res.status(204).end();
}
