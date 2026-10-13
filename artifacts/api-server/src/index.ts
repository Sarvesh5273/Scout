import app from "./app";
import { logger } from "./lib/logger";
import { seedShowcases, startScheduler } from "./lib/scheduler";
import { recoverRuns } from "./pipeline/queue";

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

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

let stopScheduler: (() => void) | null = null;

async function startBackground(): Promise<void> {
  await recoverRuns();
  await seedShowcases();
  stopScheduler = startScheduler();
}

startBackground().catch((err: unknown) => {
  logger.error({ err }, "Background startup failed; searches still work, scheduled refreshes are off");
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  stopScheduler?.();
  server.close();
  // In-flight runs are marked failed on the next start (see recoverRuns).
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
