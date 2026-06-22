import Anthropic from "@anthropic-ai/sdk";

// ── Centralized model + prompt config (spec §11) ─────────────────────────────
// Swap model IDs here in one place. Current IDs verified against the Claude
// model lineup at build time; triage uses the cheap Haiku tier. The stronger
// drafting model (Phase 3) will be added here too.
export const MODELS = {
  triage: "claude-haiku-4-5-20251001",
} as const;

// Bump when the triage prompt changes so we can tell which version classified a
// thread (mirrors `prompt_version` on drafts).
export const TRIAGE_PROMPT_VERSION = "triage-v1";

export function makeAnthropic(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
