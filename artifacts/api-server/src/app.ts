import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { trackActivity } from "./lib/activity";
import { logger } from "./lib/logger";

const app: Express = express();

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.use("/api", trackActivity, router);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Express 5 forwards rejected async handlers here. Details go to the log, never to the client.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: unknown; type?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? "Request too large" : "Invalid request" });
    return;
  }
  req.log.error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

export default app;
