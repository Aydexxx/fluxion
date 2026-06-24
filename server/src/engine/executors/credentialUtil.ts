import type { CredentialSecret, ExecutionContext } from "../types";

/**
 * Resolves a node's `credentialId` to its decrypted fields, enforcing that the
 * credential exists, is reachable from this run's workspace, and is of the type
 * the node expects. Centralized so every secret-using executor fails the same
 * clear way (and never leaks which check failed beyond what's safe to say).
 */
export async function resolveCredential(
  context: ExecutionContext,
  credentialId: unknown,
  expectedType: string,
): Promise<CredentialSecret> {
  if (typeof credentialId !== "string" || credentialId.trim() === "") {
    throw new Error(`This node requires a ${expectedType} credential (set its credentialId)`);
  }
  const credential = await context.credentials.resolve(credentialId);
  if (!credential) {
    throw new Error(`Credential "${credentialId}" was not found in this workspace`);
  }
  if (credential.type !== expectedType) {
    throw new Error(`Credential "${credentialId}" is a ${credential.type}, but this node needs a ${expectedType}`);
  }
  return credential;
}
