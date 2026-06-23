import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import healthRoutes from "./routes/health.routes";
import runRoutes from "./routes/runs.routes";
import webhookRoutes from "./routes/webhooks.routes";
import workflowRoutes from "./routes/workflows.routes";
import workspaceRoutes from "./routes/workspaces.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

/** Build and configure the Express application (no network binding here). */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.clientUrl, credentials: true }));
  app.use(express.json());

  app.use("/health", healthRoutes);
  app.use("/auth", authRoutes);
  app.use("/workspaces", workspaceRoutes);
  app.use("/workflows", workflowRoutes);
  app.use("/runs", runRoutes);
  app.use("/webhooks", webhookRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
