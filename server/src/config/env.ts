import dotenv from "dotenv";

dotenv.config();

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

/** Valid LLM providers; anything else in the env falls back to the dev default. */
const LLM_PROVIDERS = ["none", "ollama", "openai"] as const;
type LlmProvider = (typeof LLM_PROVIDERS)[number];

function llmProvider(): LlmProvider {
  const value = process.env.LLM_PROVIDER;
  return (LLM_PROVIDERS as readonly string[]).includes(value ?? "") ? (value as LlmProvider) : "ollama";
}

/** Strongly-typed, validated view of the process environment. */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number.parseInt(required("PORT", "4000"), 10),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  jwtExpiresIn: required("JWT_EXPIRES_IN", "7d"),
  clientUrl: required("CLIENT_URL", "http://localhost:5173"),
  // Redis powers both the BullMQ queue and the Socket.IO cross-process adapter.
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
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
} as const;

export type Env = typeof env;
