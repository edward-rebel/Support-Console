import type { ConfidenceLevel, Sentiment, ThreadStatus } from "@ms/shared";

// Sentiment pill tokens (reuse existing palette). Neutral is intentionally muted
// so the inbox only highlights notable sentiment.
const SENTIMENT_TOKENS: Record<Sentiment, { bg: string; fg: string }> = {
  positive: { bg: "var(--accent-soft-bg)", fg: "var(--accent-soft-fg)" },
  neutral: { bg: "var(--surface-2)", fg: "var(--text-3)" },
  negative: { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)" },
  frustrated: { bg: "var(--warn-bg)", fg: "var(--warn-tx)" },
};
const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Unhappy",
  frustrated: "Frustrated",
};
const SENTIMENT_EMOJI: Record<Sentiment, string> = {
  positive: "🙂",
  neutral: "😐",
  negative: "🙁",
  frustrated: "😠",
};
export function sentimentTokens(s: Sentiment) {
  return SENTIMENT_TOKENS[s];
}
export function sentimentLabel(s: Sentiment): string {
  return SENTIMENT_LABEL[s];
}
export function sentimentEmoji(s: Sentiment): string {
  return SENTIMENT_EMOJI[s];
}

// Map a category slug to its design token pair. Falls back to "other".
const CATEGORY_TOKENS: Record<string, { bg: string; fg: string }> = {
  exchange: { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)" },
  shipping: { bg: "var(--cat-shipping-bg)", fg: "var(--cat-shipping-fg)" },
  sizing: { bg: "var(--cat-sizing-bg)", fg: "var(--cat-sizing-fg)" },
  discount: { bg: "var(--cat-discount-bg)", fg: "var(--cat-discount-fg)" },
  other: { bg: "var(--cat-other-bg)", fg: "var(--cat-other-fg)" },
};

export function categoryTokens(slug: string | null | undefined) {
  return CATEGORY_TOKENS[slug ?? "other"] ?? CATEGORY_TOKENS.other!;
}

const STATUS_LABELS: Record<ThreadStatus, string> = {
  new: "New",
  drafting: "Drafting",
  needs_review: "Needs Review",
  sent: "Sent",
  dismissed: "Dismissed",
  closed: "Closed",
};

const STATUS_TOKENS: Record<ThreadStatus, { bg: string; fg: string }> = {
  new: { bg: "var(--st-new-bg)", fg: "var(--st-new-fg)" },
  drafting: { bg: "var(--st-drafting-bg)", fg: "var(--st-drafting-fg)" },
  needs_review: { bg: "var(--st-review-bg)", fg: "var(--st-review-fg)" },
  sent: { bg: "var(--st-sent-bg)", fg: "var(--st-sent-fg)" },
  dismissed: { bg: "var(--st-dismissed-bg)", fg: "var(--st-dismissed-fg)" },
  closed: { bg: "var(--st-dismissed-bg)", fg: "var(--st-dismissed-fg)" },
};

export function statusLabel(status: ThreadStatus): string {
  return STATUS_LABELS[status] ?? status;
}
export function statusTokens(status: ThreadStatus) {
  return STATUS_TOKENS[status] ?? STATUS_TOKENS.new;
}
export function statusPulses(status: ThreadStatus): boolean {
  return status === "drafting";
}

const CONF_COLOR: Record<ConfidenceLevel, string> = {
  high: "var(--conf-high)",
  medium: "var(--conf-med)",
  low: "var(--conf-low)",
};
const CONF_LABEL: Record<ConfidenceLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
const CONF_DOTS: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
export function confColor(level: ConfidenceLevel): string {
  return CONF_COLOR[level];
}
export function confLabel(level: ConfidenceLevel): string {
  return CONF_LABEL[level];
}
export function confDots(level: ConfidenceLevel): number {
  return CONF_DOTS[level];
}

// Deterministic avatar tint from a string, drawn from the category palettes.
const AVATAR_PALETTE = [
  { bg: "var(--cat-exchange-bg)", fg: "var(--cat-exchange-fg)" },
  { bg: "var(--cat-shipping-bg)", fg: "var(--cat-shipping-fg)" },
  { bg: "var(--cat-sizing-bg)", fg: "var(--cat-sizing-fg)" },
  { bg: "var(--cat-discount-bg)", fg: "var(--cat-discount-fg)" },
  { bg: "var(--cat-other-bg)", fg: "var(--cat-other-fg)" },
];
export function avatarTokens(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

export function initialsFrom(
  name: string | null,
  email: string | null,
): string {
  const source = (name ?? email ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

// Relative-ish short time label for inbox rows.
export function shortTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day && date.getDate() === new Date().getDate()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffMs < 7 * day) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
