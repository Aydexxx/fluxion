import dotenv from "dotenv";
import { loadEncryptionKey } from "../services/crypto";

dotenv.config();

/**
 * Dev-only fallback key. Real deployments MUST set `CREDENTIALS_KEY`; this
 * fixed value only exists so a fresh local checkout boots without ceremony.
 * Rotating to a new key makes existing encrypted credentials unreadable.
 */
const DEV_CREDENTIALS_KEY = "2mLPAPxi2jTwoTjIR2QeSFgD1ZU2t2vBX5183NZIb54=";

/** Read a required env var, throwing a clear error if it is missing. */
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Parse an integer env var, falling back when unset or malformed. */
function int(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a boolean env var ("true"/"1" -> true), falling back when unset. */
function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

/** Valid LLM providers; anything else in the env falls back to the dev default. */
const LLM_PROVIDERS = ["none", "ollama", "openai"] as const;
type LlmProvider = (typeof LLM_PROVIDERS)[number];

function llmProvider(): LlmProvider {
  const value = process.env.LLM_PROVIDER;
  return (LLM_PROVIDERS as readonly string[]).includes(value ?? "") ? (value as LlmProvider) : "ollama";
}

const nodeEnv = process.env.NODE_ENV ?? "development";

/** Strongly-typed, validated view of the process environment. */
export const env = {
  nodeEnv,
  port: Number.parseInt(required("PORT", "4000"), 10),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: required("JWT_EXPIRES_IN", "7d"),
  clientUrl: required("CLIENT_URL", "http://localhost:5173"),
  // Redis powers both the BullMQ queue and the Socket.IO cross-process adapter.
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  // Master key for credential encryption at rest (AES-256-GCM). Loaded and
  // validated once at startup so a bad key fails fast. See README for rotation.
  credentialsKey: loadEncryptionKey(required("CREDENTIALS_KEY", DEV_CREDENTIALS_KEY)),
  // Distributed execution knobs. attempts/backoff drive retry + dead-letter;
  // concurrency caps how many runs a single worker executes at once so external
  // APIs aren't overwhelmed.
  queue: {
    attempts: int("QUEUE_MAX_ATTEMPTS", 3),
    backoffMs: int("QUEUE_BACKOFF_MS", 1000),
    concurrency: int("WORKER_CONCURRENCY", 5),
  },
  // Provider-agnostic LLM layer. Dev default is `ollama` (local, no key); the
  // `none` stub keeps the engine fully offline; `openai` stays inert until a key
  // is supplied. No provider is hardcoded — selection is env-driven.
  llm: {
    provider: llmProvider(),
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    ollamaModel: process.env.OLLAMA_MODEL ?? "llama3",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  },
  // Per-node execution timeouts (ms). A hung HTTP/AI node can't pin a worker
  // forever; node config may lower these per node, never raise above sanity.
  nodeTimeouts: {
    httpMs: int("NODE_HTTP_TIMEOUT_MS", 30_000),
    aiMs: int("NODE_AI_TIMEOUT_MS", 60_000),
  },
  // Composition: how deep the `flow.subworkflow` (Call Workflow) call chain may
  // nest before the engine rejects further calls. Cycles are detected separately.
  subworkflow: {
    maxDepth: int("SUBWORKFLOW_MAX_DEPTH", 5),
  },
  // Rate limiting for abuse-prone surfaces (auth + public webhooks). Disabled
  // under test so route tests aren't throttled; the limiter is unit-tested
  // directly. Toggle/limits are env-overridable for ops tuning.
  rateLimit: {
    enabled: bool("RATE_LIMIT_ENABLED", nodeEnv !== "test"),
    authWindowMs: int("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
    authMax: int("AUTH_RATE_LIMIT_MAX", 50),
    webhookWindowMs: int("WEBHOOK_RATE_LIMIT_WINDOW_MS", 60_000),
    webhookMax: int("WEBHOOK_RATE_LIMIT_MAX", 120),
    // Public `/api/v1` surface, throttled per API key (not per IP).
    publicApiWindowMs: int("PUBLIC_API_RATE_LIMIT_WINDOW_MS", 60_000),
    publicApiMax: int("PUBLIC_API_RATE_LIMIT_MAX", 120),
  },
  // Structured logging. Silent under test to keep output clean; pretty-ish JSON
  // otherwise. Correlation ids (request id / run id) are attached per log.
  log: {
    level: process.env.LOG_LEVEL ?? (nodeEnv === "test" ? "silent" : "info"),
  },
} as const;

export type Env = typeof env;
