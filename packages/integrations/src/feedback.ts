import type { IntegrationsConfig } from "./config";
import { generateStructured, hasTriageProvider, MODELS } from "./ai";
import type { FeedbackType } from "@ms/shared";
import { FEEDBACK_TYPES } from "@ms/shared";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: ["bug", "feature", "enhancement", "question", "other"],
    },
    title: { type: "string" },
  },
  required: ["type", "title"],
} as const;

const SYSTEM = `You triage in-app feedback for the Molly & Stitch Support Console (an operator tool). Classify the message and write a concise title.
type:
- bug: something is broken, errors, or doesn't work as expected.
- feature: a brand-new capability is being requested.
- enhancement: improve or tweak something that already exists.
- question: a how-to or clarification, not a request to change anything.
- other: anything else.
title: a clear summary in 8 words or fewer (no trailing period).`;

// Classify free-text feedback into a type + short title using the cheap model.
// Returns null if no AI provider is configured or the call fails — the feedback
// is still stored, just untriaged (and can be re-triaged later).
export async function triageFeedback(
  cfg: IntegrationsConfig,
  message: string,
): Promise<{ type: FeedbackType; title: string } | null> {
  if (!hasTriageProvider(cfg)) return null;
  try {
    const out = await generateStructured<{ type: string; title: string }>(cfg, {
      systemPrompt: SYSTEM,
      userPrompt: message.slice(0, 2000),
      schema: SCHEMA as unknown as Record<string, unknown>,
      schemaName: "feedback_triage",
      models: MODELS.triage,
    });
    const type = FEEDBACK_TYPES.includes(out.type as FeedbackType)
      ? (out.type as FeedbackType)
      : "other";
    const title = (out.title ?? "").trim().slice(0, 120) || null;
    return { type, title: title ?? message.trim().slice(0, 60) };
  } catch {
    return null;
  }
}
