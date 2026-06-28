import cors from "cors";
import express, { type Express } from "express";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import analyticsRoutes from "./routes/analytics.routes";
import credentialRoutes from "./routes/credentials.routes";
import healthRoutes from "./routes/health.routes";
import inviteRoutes from "./routes/invites.routes";
import notificationRoutes from "./routes/notifications.routes";
import publicApiRoutes from "./routes/publicApi.routes";
import runRoutes from "./routes/runs.routes";
import templateRoutes from "./routes/templates.routes";
import { secretRoutes, variableRoutes } from "./routes/variables.routes";
import webhookRoutes from "./routes/webhooks.routes";
import workflowRoutes from "./routes/workflows.routes";
import workspaceRoutes from "./routes/workspaces.routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import { createRateLimiter } from "./middleware/rateLimit";

/** Build and configure the Express application (no network binding here). */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.clientUrl, credentials: true }));
  // Correlation id + structured request logging first, so even throttled or
  // rejected requests are traceable.
  app.use(requestContext);

  // Throttle abuse-prone surfaces. Disabled under test (see env.rateLimit) so
  // route tests aren't tripped; the limiter is unit-tested in isolation.
  if (env.rateLimit.enabled) {
    app.use(
      "/auth",
      createRateLimiter({ windowMs: env.rateLimit.authWindowMs, max: env.rateLimit.authMax, message: "Too many authentication attempts, please slow down" }),
    );
    app.use(
      "/webhooks",
      createRateLimiter({ windowMs: env.rateLimit.webhookWindowMs, max: env.rateLimit.webhookMax, message: "Webhook rate limit exceeded" }),
    );
  }

  app.use(express.json());

  app.use("/health", healthRoutes);
  app.use("/auth", authRoutes);
  app.use("/workspaces", workspaceRoutes);
  app.use("/invites", inviteRoutes);
  app.use("/notifications", notificationRoutes);
  app.use("/credentials", credentialRoutes);
  app.use("/variables", variableRoutes);
  app.use("/secrets", secretRoutes);
  app.use("/workflows", workflowRoutes);
  app.use("/templates", templateRoutes);
  app.use("/runs", runRoutes);
  app.use("/analytics", analyticsRoutes);
  app.use("/webhooks", webhookRoutes);
  // Public, API-key-authenticated REST surface — separate from the session API above.
  app.use("/api/v1", publicApiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
