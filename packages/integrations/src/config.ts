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
