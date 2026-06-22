import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { loadEnv } from "./env";
import { createContext } from "./context";
import { registerAuthRoutes } from "./auth";
import { registerThreadRoutes } from "./routes/threads";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerSyncRoutes } from "./routes/sync";
import { registerTriageRoutes } from "./routes/triage";
import { registerSenderRuleRoutes } from "./routes/sender-rules";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { SyncRunner } from "./sync-runner";

async function main() {
  const env = loadEnv();

  // Treat Railway (or explicit NODE_ENV=production) as production: behind a TLS
  // proxy, with secure cookies and the in-process ingestion scheduler enabled.
  const isProd =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT);

  const app = Fastify({
    // Railway terminates TLS and forwards; trust the proxy for secure cookies.
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.LOG_PRETTY === "1"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
  });

  app.appCtx = createContext(env);

  // Tolerate empty bodies on JSON requests (e.g. bodyless POST /sync, /logout)
  // instead of returning 400 FST_ERR_CTP_EMPTY_JSON_BODY.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (body === "" || body == null) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // CORS for the web origin; harmless in the combined deployment (same origin),
  // and required when the web runs on a separate origin in local dev.
  await app.register(cors, {
    origin: env.webBaseUrl,
    credentials: true,
  });

  await app.register(cookie);
  await app.register(session, {
    secret: env.sessionSecret,
    cookieName: "ms_session",
    cookie: {
      httpOnly: true,
      sameSite: "lax", // combined service is same-origin, so lax is sufficient
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
    saveUninitialized: false,
  });

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerThreadRoutes(app);
  registerOAuthRoutes(app);
  registerTriageRoutes(app);
  registerSenderRuleRoutes(app);
  registerKnowledgeRoutes(app);

  // Shared ingestion runner — used by the manual /sync route and the scheduler.
  const runner = new SyncRunner(app.appCtx.db, env.integrations);
  registerSyncRoutes(app, runner);

  // Serve the built web SPA when present (combined-service deployment). The API
  // routes above take precedence; any other GET falls back to index.html.
  const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
    app.log.info(`Serving web UI from ${webDist}`);
  } else {
    app.log.info("No web build found; running API only (web served separately)");
  }

  const close = async () => {
    app.log.info("Shutting down…");
    await app.close();
    await app.appCtx.closeDb();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ port: env.port, host: "0.0.0.0" });

  // In-process ingestion scheduler (combined-service deployment). Idempotent and
  // never sends email. Disabled outside production so local dev controls sync
  // manually (or via the standalone worker).
  if (isProd) {
    const intervalMs = Math.max(1, env.syncIntervalMinutes) * 60 * 1000;
    const kick = () =>
      runner.start((msg, err) => {
        if (err) app.log.error({ err }, msg);
        else app.log.info(msg);
      });
    kick();
    setInterval(kick, intervalMs);
    app.log.info(
      `Ingestion scheduler enabled: every ${env.syncIntervalMinutes} min`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
