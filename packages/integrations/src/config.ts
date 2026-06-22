// Configuration passed explicitly into integration functions (no env reads
// inside this package — apps own their env and inject these values).

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface IntegrationsConfig {
  google: GoogleConfig;
  encryptionKey: string;
  gmailAccount: string;
  backfillMonths: number;
  // Optional so ingestion works before AI keys are configured. Triage is a
  // no-op (leaves threads unclassified) until at least one provider is set.
  anthropicApiKey?: string;
  openaiApiKey?: string;
  aiProviderOrder: AiProvider[];
  // Key for the embeddings provider (Phase 2 knowledge base). Defaults to the
  // OpenAI key since embeddings currently run on OpenAI; kept separate so the
  // embeddings provider can be swapped without touching triage/drafting keys.
  embeddingsApiKey?: string;
  // Read-only Shopify (Phase 4). Optional: lookups are a no-op until set. We
  // mint short-lived Admin API tokens from apiKey+apiSecret on demand (client
  // credentials grant) — no token is stored. READ SCOPES ONLY; never write.
  shopify?: ShopifyConfig;
}

export interface ShopifyConfig {
  storeDomain: string; // e.g. mollyandstitchus.myshopify.com
  apiKey: string; // app Client ID
  apiSecret: string; // app secret (shpss_…)
  apiVersion: string; // e.g. 2026-01
}

export const AI_PROVIDERS = ["anthropic", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export function parseAiProviderOrder(value: string | undefined): AiProvider[] {
  const requested = (value ?? "anthropic,openai")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is AiProvider =>
      AI_PROVIDERS.includes(v as AiProvider),
    );
  return requested.length > 0
    ? [...new Set(requested)]
    : ["anthropic", "openai"];
}

// The Gmail scope used in Phase 0 — READ ONLY. The send/modify scopes are added
// only at Phase 3 when the guarded send path is introduced.
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
