import { createServer } from "node:http";
import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { attachRealtime } from "./realtime/io";
import { createNotificationEmitter } from "./realtime/notificationEmitter";
import { setNotificationPublisher } from "./realtime/notifications";

const app = createApp();
const httpServer = createServer(app);

// Socket.IO shares the HTTP server so the editor gets live run updates.
attachRealtime(httpServer);

// In-app notifications created on the API side (invites, role changes) are
// pushed to the recipient's user channel via the Redis emitter.
const { publisher } = createNotificationEmitter();
setNotificationPublisher(publisher);

httpServer.listen(env.port, () => {
  logger.info({ port: env.port }, "api.listening");
});
