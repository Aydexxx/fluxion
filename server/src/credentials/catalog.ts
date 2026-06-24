/**
 * Catalog of supported credential types and their fields.
 *
 * Each type declares the fields a user enters and, per field, whether it is a
 * `secret` (encrypted, never returned to the client) or public metadata (safe
 * to echo back so the management UI can pre-fill it on edit). `previewKey`
 * names the single secret whose last 4 characters form a non-sensitive hint
 * (e.g. an API key tail); `null` means no preview at all.
 *
 * This is the single source of truth the validation layer and the executors
 * both read, so adding a credential type is one entry here.
 */

export interface CredentialFieldSpec {
  key: string;
  label: string;
  /** Encrypted at rest and never serialized back to the client. */
  secret: boolean;
  /** Field may be omitted when creating/editing the credential. */
  optional?: boolean;
  placeholder?: string;
}

export interface CredentialTypeSpec {
  type: string;
  label: string;
  /** Short description for the management UI. */
  blurb: string;
  fields: CredentialFieldSpec[];
  /** Secret field whose last 4 chars form a safe preview, or null for none. */
  previewKey: string | null;
}

export const CREDENTIAL_TYPES: Record<string, CredentialTypeSpec> = {
  http_bearer: {
    type: "http_bearer",
    label: "HTTP Bearer",
    blurb: "A bearer token for Authorization headers.",
    fields: [{ key: "token", label: "Token", secret: true, placeholder: "sk-…" }],
    previewKey: "token",
  },
  smtp: {
    type: "smtp",
    label: "SMTP",
    blurb: "An outbound mail server for the Email node.",
    fields: [
      { key: "host", label: "Host", secret: false, placeholder: "smtp.example.com" },
      { key: "port", label: "Port", secret: false, placeholder: "587" },
      { key: "username", label: "Username", secret: false },
      { key: "password", label: "Password", secret: true },
      { key: "from", label: "From address", secret: false, placeholder: "bot@example.com" },
      { key: "secure", label: "Use TLS (true/false)", secret: false, optional: true, placeholder: "false" },
    ],
    previewKey: null,
  },
  openai: {
    type: "openai",
    label: "OpenAI",
    blurb: "An OpenAI-compatible API key for AI nodes.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, placeholder: "sk-…" },
      { key: "baseUrl", label: "Base URL", secret: false, optional: true, placeholder: "https://api.openai.com/v1" },
    ],
    previewKey: "apiKey",
  },
  slack_webhook: {
    type: "slack_webhook",
    label: "Slack / Discord webhook",
    blurb: "An incoming-webhook URL for the Slack node.",
    fields: [{ key: "url", label: "Webhook URL", secret: true, placeholder: "https://hooks.slack.com/services/…" }],
    previewKey: null,
  },
  database: {
    type: "database",
    label: "Database",
    blurb: "A Postgres connection string for the Database node.",
    fields: [
      {
        key: "connectionString",
        label: "Connection string",
        secret: true,
        placeholder: "postgresql://user:pass@host:5432/db",
      },
    ],
    previewKey: null,
  },
};

export type CredentialType = keyof typeof CREDENTIAL_TYPES;

export function getCredentialTypeSpec(type: string): CredentialTypeSpec | undefined {
  return CREDENTIAL_TYPES[type];
}

export function isKnownCredentialType(type: string): boolean {
  return type in CREDENTIAL_TYPES;
}
