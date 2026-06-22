import { config } from "dotenv";
import { resolve } from "node:path";
import type { IntegrationsConfig } from "@ms/integrations";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export interface WorkerEnv {
  databaseUrl: string;
  intervalMinutes: number;
  integrations: IntegrationsConfig;
}

export function loadEnv(): WorkerEnv {
  const appBaseUrl = opt("APP_BASE_URL", "http://localhost:4000");
  return {
    databaseUrl: req("DATABASE_URL"),
    intervalMinutes: Number(opt("SYNC_INTERVAL_MINUTES", "5")),
    integrations: {
      google: {
        // Optional so the worker boots before Gmail is connected; runSync then
        // reports "not connected" and retries next interval rather than crashing.
        clientId: opt("GOOGLE_CLIENT_ID", ""),
        clientSecret: opt("GOOGLE_CLIENT_SECRET", ""),
        redirectUri: opt(
          "GOOGLE_REDIRECT_URI",
          `${appBaseUrl}/auth/google/callback`,
        ),
      },
      encryptionKey: req("ENCRYPTION_KEY"),
      gmailAccount: opt("GMAIL_ACCOUNT", "contact@mollyandstitch.us"),
      backfillMonths: Number(opt("BACKFILL_MONTHS", "6")),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    },
  };
}
