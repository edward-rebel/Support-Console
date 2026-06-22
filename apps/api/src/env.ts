import { config } from "dotenv";
import { resolve } from "node:path";
import { parseAiProviderOrder, type IntegrationsConfig } from "@ms/integrations";

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

export interface ApiEnv {
  databaseUrl: string;
  sessionSecret: string;
  webBaseUrl: string;
  appBaseUrl: string;
  port: number;
  // Minutes between in-process ingestion runs (combined-service deployment).
  syncIntervalMinutes: number;
  integrations: IntegrationsConfig;
}

export function loadEnv(): ApiEnv {
  const appBaseUrl = opt("APP_BASE_URL", "http://localhost:4000");
  return {
    databaseUrl: req("DATABASE_URL"),
    sessionSecret: req("SESSION_SECRET"),
    webBaseUrl: opt("WEB_BASE_URL", "http://localhost:5173"),
    appBaseUrl,
    port: Number(opt("PORT", "4000")),
    syncIntervalMinutes: Number(opt("SYNC_INTERVAL_MINUTES", "5")),
    integrations: {
      google: {
        // Optional at boot so the operator can log in and view the (empty)
        // inbox before configuring Gmail. The OAuth routes return a clear error
        // if these are unset when a connection is attempted.
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
      openaiApiKey: process.env.OPENAI_API_KEY,
      aiProviderOrder: parseAiProviderOrder(process.env.AI_PROVIDER_ORDER),
      embeddingsApiKey: process.env.EMBEDDINGS_API_KEY,
    },
  };
}
