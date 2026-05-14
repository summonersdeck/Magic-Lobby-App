import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachWebSocketServer } from "./games/ws";
import { cleanupOldGames } from "./games/store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachWebSocketServer(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening (HTTP + WS)");

  // Run cleanup once on startup, then every hour automatically
  cleanupOldGames(12)
    .then(({ deleted }) => {
      if (deleted > 0) logger.info({ deleted }, "Startup cleanup: removed old games");
    })
    .catch((err) => logger.warn({ err }, "Startup cleanup failed"));

  setInterval(
    () => {
      cleanupOldGames(12)
        .then(({ deleted }) => {
          if (deleted > 0) logger.info({ deleted }, "Scheduled cleanup: removed old games");
        })
        .catch((err) => logger.warn({ err }, "Scheduled cleanup failed"));
    },
    60 * 60 * 1000, // every hour
  );
});
