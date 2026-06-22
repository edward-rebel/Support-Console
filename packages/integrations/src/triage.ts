import { eq, sql } from "drizzle-orm";
import { categories, messages, senderRules, threads, type Db } from "@ms/db";
import { CATEGORIES, type SenderRuleKind } from "@ms/shared";
import type { IntegrationsConfig } from "./config";
import { makeAnthropic, MODELS } from "./ai";

const CLASSIFY_CONCURRENCY = 6;
const BODY_LIMIT = 2000;

export interface TriageResult {
  considered: number;
  blockedByRule: number;
  allowedByRule: number;
  classifiedByModel: number;
  markedCustomer: number;
  markedNoise: number;
  skippedNoKey: number;
}

interface RuleRow {
  pattern: string;
  rule: SenderRuleKind;
}

// Match an email against the sender rules. Exact-address rules win over
// wildcard "*@domain" rules; returns the matched rule kind or null.
export function matchSenderRule(
  email: string | null,
  rules: RuleRow[],
): SenderRuleKind | null {
  if (!email) return null;
  const lower = email.toLowerCase().trim();
  const domain = lower.split("@")[1] ?? "";
  let wildcard: SenderRuleKind | null = null;
  for (const r of rules) {
    const p = r.pattern.toLowerCase();
    if (p === lower) return r.rule; // exact match wins immediately
    if (p.startsWith("*@") && p.slice(2) === domain) wildcard = r.rule;
  }
  return wildcard;
}

// Minimal server-side HTML→text for classification input (no DOM needed).
function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

const SYSTEM_PROMPT = `You triage the customer-support inbox for Molly & Stitch, an e-commerce brand selling handmade leather dog accessories.

Decide two things about an email:
1. is_customer: true only if it is a GENUINE message from a real customer (or prospective customer) that needs a human support reply — questions about orders, exchanges, sizing, shipping, discounts, products, complaints, etc. Set false for automated notifications, marketing, receipts, platform/app alerts, payout/chargeback notices, vendor or partner outreach, and anything not requiring a personal support reply.
2. category: the best-fit request type.
   - exchange: returns, exchanges, damaged/defective items, refunds.
   - shipping: order/shipment status, tracking, delivery problems, address changes.
   - sizing: size/fit questions, measurements, which size to pick.
   - discount: discount codes, promos, coupon problems, price questions.
   - other: anything else, or when is_customer is false.

Always call the classify_support_email tool. Be decisive; use "other" when unsure of the category.`;

interface ClassifyInput {
  fromEmail: string | null;
  subject: string | null;
  body: string;
}

async function classify(
  client: ReturnType<typeof makeAnthropic>,
  input: ClassifyInput,
): Promise<{ isCustomer: boolean; categorySlug: string; confidence: string }> {
  const res = await client.messages.create({
    model: MODELS.triage,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "classify_support_email",
        description: "Record the triage classification for this email.",
        input_schema: {
          type: "object",
          properties: {
            is_customer: { type: "boolean" },
            category: { type: "string", enum: CATEGORY_SLUGS },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["is_customer", "category", "confidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_support_email" },
    messages: [
      {
        role: "user",
        content: `From: ${input.fromEmail ?? "(unknown)"}\nSubject: ${input.subject ?? "(none)"}\n\n${input.body || "(no body)"}`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Triage model did not return a classification");
  }
  const data = block.input as {
    is_customer?: boolean;
    category?: string;
    confidence?: string;
  };
  const categorySlug = CATEGORY_SLUGS.includes(data.category ?? "")
    ? (data.category as string)
    : "other";
  return {
    isCustomer: Boolean(data.is_customer),
    categorySlug,
    confidence: data.confidence ?? "medium",
  };
}

interface CandidateRow {
  id: string;
  customer_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
}

// Classify every thread with is_customer IS NULL. Deterministic sender rules
// run first (free); only non-blocked threads reach the model. Idempotent and
// re-runnable; never sends email.
export async function runTriage(
  db: Db,
  cfg: IntegrationsConfig,
  limit = 5000,
): Promise<TriageResult> {
  const result: TriageResult = {
    considered: 0,
    blockedByRule: 0,
    allowedByRule: 0,
    classifiedByModel: 0,
    markedCustomer: 0,
    markedNoise: 0,
    skippedNoKey: 0,
  };

  const ruleRows = (await db
    .select({ pattern: senderRules.pattern, rule: senderRules.rule })
    .from(senderRules)) as RuleRow[];

  const catRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const catIdBySlug = new Map(catRows.map((c) => [c.slug, c.id]));

  // Candidate threads + their latest inbound message body.
  const candidates = (await db.execute(sql`
    SELECT t.id, t.customer_email, t.subject, m.body_text, m.body_html
    FROM ${threads} t
    LEFT JOIN LATERAL (
      SELECT body_text, body_html FROM ${messages}
      WHERE thread_id = t.id AND direction = 'inbound'
      ORDER BY gmail_internal_date DESC NULLS LAST
      LIMIT 1
    ) m ON true
    WHERE t.is_customer IS NULL
    LIMIT ${limit}
  `)) as unknown as CandidateRow[];

  result.considered = candidates.length;

  await runOver(db, cfg, candidates, ruleRows, catIdBySlug, result);
  return result;
}

async function runOver(
  db: Db,
  cfg: IntegrationsConfig,
  candidates: CandidateRow[],
  ruleRows: RuleRow[],
  catIdBySlug: Map<string, string>,
  result: TriageResult,
): Promise<void> {
  const client = cfg.anthropicApiKey ? makeAnthropic(cfg.anthropicApiKey) : null;

  await pooled(candidates, CLASSIFY_CONCURRENCY, async (row) => {
    const matched = matchSenderRule(row.customer_email, ruleRows);

    // Block rule → noise, no model call.
    if (matched === "block") {
      await db
        .update(threads)
        .set({ isCustomer: false, updatedAt: new Date() })
        .where(eq(threads.id, row.id));
      result.blockedByRule++;
      result.markedNoise++;
      return;
    }

    if (matched === "allow") result.allowedByRule++;

    // Without an API key we can only apply deterministic rules.
    if (!client) {
      result.skippedNoKey++;
      return;
    }

    const body = row.body_text?.trim()
      ? row.body_text.trim()
      : row.body_html
        ? stripHtml(row.body_html)
        : "";

    try {
      const out = await classify(client, {
        fromEmail: row.customer_email,
        subject: row.subject,
        body: body.slice(0, BODY_LIMIT),
      });
      // Trust the allowlist for is_customer; use the model for the category.
      const isCustomer = matched === "allow" ? true : out.isCustomer;
      const categoryId = isCustomer
        ? (catIdBySlug.get(out.categorySlug) ?? null)
        : null;
      await db
        .update(threads)
        .set({ isCustomer, categoryId, updatedAt: new Date() })
        .where(eq(threads.id, row.id));
      result.classifiedByModel++;
      if (isCustomer) result.markedCustomer++;
      else result.markedNoise++;
    } catch {
      // Leave is_customer NULL so the next run retries this thread.
    }
  });
}

// Reclassify a single thread (operator override from the inbox). When
// forceCustomer is set, that decision is authoritative and only the category
// comes from the model; otherwise the model decides both.
export async function reclassifyThread(
  db: Db,
  cfg: IntegrationsConfig,
  threadId: string,
  opts: { forceCustomer?: boolean } = {},
): Promise<{ isCustomer: boolean | null } | null> {
  const rows = (await db.execute(sql`
    SELECT t.id, t.customer_email, t.subject, m.body_text, m.body_html
    FROM ${threads} t
    LEFT JOIN LATERAL (
      SELECT body_text, body_html FROM ${messages}
      WHERE thread_id = t.id AND direction = 'inbound'
      ORDER BY gmail_internal_date DESC NULLS LAST
      LIMIT 1
    ) m ON true
    WHERE t.id = ${threadId}
    LIMIT 1
  `)) as unknown as CandidateRow[];
  const row = rows[0];
  if (!row) return null;

  // Explicit "not a customer" override → noise, no model call.
  if (opts.forceCustomer === false) {
    await db
      .update(threads)
      .set({ isCustomer: false, categoryId: null, updatedAt: new Date() })
      .where(eq(threads.id, threadId));
    return { isCustomer: false };
  }

  const client = cfg.anthropicApiKey ? makeAnthropic(cfg.anthropicApiKey) : null;
  let isCustomer: boolean = opts.forceCustomer ?? true;
  let categoryId: string | null = null;

  if (client) {
    const catRows = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories);
    const catIdBySlug = new Map(catRows.map((c) => [c.slug, c.id]));
    const body = row.body_text?.trim()
      ? row.body_text.trim()
      : row.body_html
        ? stripHtml(row.body_html)
        : "";
    try {
      const out = await classify(client, {
        fromEmail: row.customer_email,
        subject: row.subject,
        body: body.slice(0, BODY_LIMIT),
      });
      if (opts.forceCustomer === undefined) isCustomer = out.isCustomer;
      categoryId = isCustomer ? (catIdBySlug.get(out.categorySlug) ?? null) : null;
    } catch {
      // Fall back to the forced/default flag with no category.
    }
  }

  await db
    .update(threads)
    .set({ isCustomer, categoryId, updatedAt: new Date() })
    .where(eq(threads.id, threadId));
  return { isCustomer };
}
