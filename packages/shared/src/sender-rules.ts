import type { SenderRuleKind } from "./enums";

// Starter triage allow/block list (spec §7, design Settings screen). Stored in
// Phase 0; deterministic triage filtering that consumes these lands in Phase 1.

export interface SenderRuleSeed {
  pattern: string;
  rule: SenderRuleKind;
  note: string;
}

export const SENDER_RULE_SEEDS: readonly SenderRuleSeed[] = [
  { pattern: "*@gmail.com", rule: "allow", note: "Consumer mailbox" },
  { pattern: "*@outlook.com", rule: "allow", note: "Consumer mailbox" },
  { pattern: "*@icloud.com", rule: "allow", note: "Consumer mailbox" },
  { pattern: "*@tiktokshop.com", rule: "block", note: "TikTok Shop notifications" },
  { pattern: "*@klaviyo.com", rule: "block", note: "Marketing platform" },
  { pattern: "*@facebookmail.com", rule: "block", note: "Meta notifications" },
  { pattern: "receipts@stripe.com", rule: "block", note: "Payment receipts" },
] as const;
