import { startWebhookServer, stopWebhookServer } from "../core/engine/webhook-server.js";
import { setOrchestratorStatus } from "../core/engine/orchestrator.js";
import { logger } from "../core/lib/logger.js";

const server = startWebhookServer();   // binds ENGINE_PORT (default 3000) internally

setOrchestratorStatus("running").catch(() => undefined);

server.on("error", (err: Error) => {
  logger.error("Server error", { error: err.message });
  process.exit(1);
});

function shutdown(): void {
  logger.info("Shutting down engine");
  stopWebhookServer(server)
    .then(() => setOrchestratorStatus("paused", "graceful shutdown", "engine"))
    .catch(() => undefined)
    .finally(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
