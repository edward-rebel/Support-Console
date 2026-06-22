import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { IntegrationsConfig, AiProvider } from "./config";

// ── Centralized model + prompt config (spec §11) ─────────────────────────────
// Swap model IDs here in one place. Triage uses the low-latency / lower-cost
// tier on each provider. Stronger drafting models (Phase 3) will be added here.
export const MODELS = {
  triage: {
    anthropic: "claude-haiku-4-5-20251001",
    openai: "gpt-5.4-mini",
  },
} as const;

// Bump when the triage prompt changes so we can tell which version classified a
// thread (mirrors `prompt_version` on drafts).
export const TRIAGE_PROMPT_VERSION = "triage-v1";

export function makeAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}

export function makeOpenAI(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

export interface ClassifySupportEmailInput {
  fromEmail: string | null;
  subject: string | null;
  body: string;
  systemPrompt: string;
  categorySlugs: string[];
}

export interface TriageClassification {
  isCustomer: boolean;
  categorySlug: string;
  confidence: "high" | "medium" | "low";
  provider: AiProvider;
  modelId: string;
}

function userContent(input: ClassifySupportEmailInput): string {
  return `From: ${input.fromEmail ?? "(unknown)"}\nSubject: ${
    input.subject ?? "(none)"
  }\n\n${input.body || "(no body)"}`;
}

function normalizeClassification(
  raw: {
    is_customer?: unknown;
    isCustomer?: unknown;
    category?: unknown;
    confidence?: unknown;
  },
  categorySlugs: string[],
): Omit<TriageClassification, "provider" | "modelId"> {
  const category =
    typeof raw.category === "string" && categorySlugs.includes(raw.category)
      ? raw.category
      : "other";
  const confidence =
    raw.confidence === "high" ||
    raw.confidence === "medium" ||
    raw.confidence === "low"
      ? raw.confidence
      : "medium";
  return {
    isCustomer: Boolean(raw.is_customer ?? raw.isCustomer),
    categorySlug: category,
    confidence,
  };
}

async function classifyWithAnthropic(
  apiKey: string,
  input: ClassifySupportEmailInput,
): Promise<TriageClassification> {
  const client = makeAnthropic(apiKey);
  const res = await client.messages.create({
    model: MODELS.triage.anthropic,
    max_tokens: 256,
    system: input.systemPrompt,
    tools: [
      {
        name: "classify_support_email",
        description: "Record the triage classification for this email.",
        input_schema: {
          type: "object",
          properties: {
            is_customer: { type: "boolean" },
            category: { type: "string", enum: input.categorySlugs },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["is_customer", "category", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_support_email" },
    messages: [{ role: "user", content: userContent(input) }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Anthropic triage did not return a classification");
  }
  return {
    ...normalizeClassification(
      block.input as Record<string, unknown>,
      input.categorySlugs,
    ),
    provider: "anthropic",
    modelId: MODELS.triage.anthropic,
  };
}

async function classifyWithOpenAI(
  apiKey: string,
  input: ClassifySupportEmailInput,
): Promise<TriageClassification> {
  const client = makeOpenAI(apiKey);
  const res = await client.responses.create({
    model: MODELS.triage.openai,
    reasoning: { effort: "low" },
    max_output_tokens: 256,
    input: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent(input) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "support_email_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_customer: { type: "boolean" },
            category: { type: "string", enum: input.categorySlugs },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["is_customer", "category", "confidence"],
        },
      },
    },
  });

  const rawText = res.output_text;
  if (!rawText) throw new Error("OpenAI triage returned an empty response");
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  return {
    ...normalizeClassification(parsed, input.categorySlugs),
    provider: "openai",
    modelId: MODELS.triage.openai,
  };
}

export function configuredAiProviders(cfg: IntegrationsConfig): AiProvider[] {
  return cfg.aiProviderOrder.filter((provider) =>
    provider === "anthropic"
      ? Boolean(cfg.anthropicApiKey)
      : Boolean(cfg.openaiApiKey),
  );
}

export function hasTriageProvider(cfg: IntegrationsConfig): boolean {
  return configuredAiProviders(cfg).length > 0;
}

export async function classifySupportEmail(
  cfg: IntegrationsConfig,
  input: ClassifySupportEmailInput,
): Promise<TriageClassification> {
  const errors: string[] = [];
  for (const provider of configuredAiProviders(cfg)) {
    try {
      if (provider === "anthropic" && cfg.anthropicApiKey) {
        return await classifyWithAnthropic(cfg.anthropicApiKey, input);
      }
      if (provider === "openai" && cfg.openaiApiKey) {
        return await classifyWithOpenAI(cfg.openaiApiKey, input);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${provider}: ${message}`);
    }
  }

  throw new Error(
    errors.length > 0
      ? `All triage AI providers failed (${errors.join("; ")})`
      : "No triage AI provider is configured",
  );
}
