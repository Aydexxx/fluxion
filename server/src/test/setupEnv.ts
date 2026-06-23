import { TEST_DATABASE_URL } from "./constants";

// Runs inside each test worker before any test file (and therefore before
// config/env.ts's dotenv.config()) loads. dotenv does not override existing
// process.env keys, so setting these here wins over .env for the test run.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = "test-secret-do-not-use-in-production";
process.env.JWT_EXPIRES_IN = "1h";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.PORT = "0";
// Keep the LLM layer offline & deterministic for the whole test run: the `none`
// provider returns a fixed stub, so no Ollama/OpenAI service is ever contacted.
process.env.LLM_PROVIDER = "none";
