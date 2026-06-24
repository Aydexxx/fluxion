import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { attachRealtime } from "./realtime/io";

const app = createApp();
const httpServer = createServer(app);

// Socket.IO shares the HTTP server so the editor gets live run updates.
attachRealtime(httpServer);

httpServer.listen(env.port, () => {
  logger.info({ port: env.port }, "api.listening");
});
