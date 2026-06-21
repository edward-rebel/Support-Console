import Fastify from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import cors from "@fastify/cors";
import { loadEnv } from "./env";
import { createContext } from "./context";
import { registerAuthRoutes } from "./auth";
import { registerThreadRoutes } from "./routes/threads";
import { registerOAuthRoutes } from "./routes/oauth";
import { registerSyncRoutes } from "./routes/sync";

async function main() {
  const env = loadEnv();

  // Treat Railway (or explicit NODE_ENV=production) as production: behind a TLS
  // proxy, requiring secure + cross-site cookies so the web and api subdomains
  // can share the session.
  const isProd =
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT);

  const app = Fastify({
    // Railway terminates TLS and forwards; trust the proxy for secure cookies.
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // pino-pretty is a dev-only dependency; only load it when asked.
      transport:
        process.env.LOG_PRETTY === "1"
          ? { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } }
          : undefined,
    },
  });

  app.appCtx = createContext(env);

  // CORS for the web origin; credentials enabled for the session cookie.
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
      // Cross-site (web subdomain → api subdomain) requires SameSite=None +
      // Secure in production; lax is fine for same-origin localhost dev.
      sameSite: isProd ? "none" : "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    },
    saveUninitialized: false,
  });

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app);
  registerThreadRoutes(app);
  registerOAuthRoutes(app);
  registerSyncRoutes(app);

  const close = async () => {
    app.log.info("Shutting down…");
    await app.close();
    await app.appCtx.closeDb();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
