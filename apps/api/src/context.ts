import { createDb, type Db } from "@ms/db";
import type { ApiEnv } from "./env";

// App-wide context: a shared db client + resolved env. Created once at startup
// and attached to the Fastify instance.
export interface AppContext {
  db: Db;
  env: ApiEnv;
  closeDb: () => Promise<void>;
}

export function createContext(env: ApiEnv): AppContext {
  const { db, sql } = createDb(env.databaseUrl);
  return {
    db,
    env,
    closeDb: () => sql.end(),
  };
}

// Fastify module augmentation so `app.appCtx` and `request.session.userId` are
// typed across the codebase.
declare module "fastify" {
  interface FastifyInstance {
    appCtx: AppContext;
  }
}

declare module "@fastify/session" {
  interface FastifySessionObject {
    userId?: string;
    oauthState?: string;
  }
}
