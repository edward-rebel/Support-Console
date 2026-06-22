import { and, asc, eq } from "drizzle-orm";
import {
  categories,
  drafts,
  messages,
  threads,
  toneProfile,
  type Db,
  type Draft,
} from "@ms/db";
import type {
  BasedOnItemDTO,
  ConfidenceLevel,
  ShopifyContextDTO,
} from "@ms/shared";
import type { IntegrationsConfig } from "./config";
import {
  configuredAiProviders,
  generateStructured,
  hasTriageProvider,
  MODELS,
  DRAFT_PROMPT_VERSION,
} from "./ai";
import { retrieveKnowledge } from "./knowledge";
import {
  formatShopifyContext,
  hasShopify,
  resolveThreadShopify,
} from "./shopify";

const BODY_LIMIT = 1500;
const HISTORY_LIMIT = 6;
const KNOWLEDGE_K = 6;
const KNOWLEDGE_CHARS = 600;

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bodyOf(m: { bodyText: string | null; bodyHtml: string | null }): string {
  const t = m.bodyText?.trim() ? m.bodyText : m.bodyHtml ? stripHtml(m.bodyHtml) : "";
  return t.slice(0, BODY_LIMIT);
}

interface DraftSchemaOut {
  reply_body: string;
  confidence: ConfidenceLevel;
  recommended_action: string;
  request_summary: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply_body: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    recommended_action: { type: "string" },
    request_summary: {
      type: "string",
      description: "1-2 sentence third-person summary of the customer's request.",
    },
  },
  required: ["reply_body", "confidence", "recommended_action", "request_summary"],
} as const;

function systemPrompt(toneText: string | null): string {
  return `You are the customer-support writer for Molly & Stitch, an e-commerce brand selling handmade leather dog accessories. You draft a reply that a human will review before it is sent.

WRITE A UNIQUE, PERSONAL REPLY — never a template. Address this specific customer and their specific situation in your own sentences. Do not paste canned text; vary your wording naturally. Reference the customer's name and the specifics of their order when available.

GROUND YOUR ANSWER in the provided knowledge (canonical answers, policies, past examples) and the order context. Do NOT invent facts, policies, prices, dates, or tracking details that aren't supported by what you're given. If you don't have enough information to answer confidently, say so honestly and offer to look into it rather than guessing.

ORDER CONTEXT: when order details are provided (status, items, tracking), use them to be specific and helpful. If a manual action is needed that you cannot perform (e.g. issuing a refund, sending a replacement, editing an order), DESCRIBE it in recommended_action as a note to the human operator — never claim you have already done it.

TONE: match the brand's voice below. Be warm, concise, and genuinely helpful.
${toneText ? `\nBrand tone profile:\n${toneText}\n` : ""}
Return:
- reply_body: the full reply, ready for the operator to review/edit. Greeting through sign-off. Plain text.
- confidence: how confident you are this reply is correct and complete (high/medium/low). Use low when key facts are missing.
- recommended_action: a short note to the operator about any manual action to take (refund, replacement, Shopify change). Empty string if none.`;
}

// Generate a draft reply for a thread: retrieve knowledge + tone + Shopify order
// context, call the drafting model, and persist a pending draft (superseding any
// prior one). Never sends email. Returns the new draft row.
export async function generateDraft(
  db: Db,
  cfg: IntegrationsConfig,
  threadId: string,
): Promise<Draft> {
  if (!hasTriageProvider(cfg)) {
    throw new Error("No AI provider is configured for drafting.");
  }

  const tRows = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      customerName: threads.customerName,
      customerEmail: threads.customerEmail,
      categoryId: threads.categoryId,
      categorySlug: categories.slug,
      summary: threads.summary,
    })
    .from(threads)
    .leftJoin(categories, eq(threads.categoryId, categories.id))
    .where(eq(threads.id, threadId))
    .limit(1);
  const t = tRows[0];
  if (!t) throw new Error("Thread not found");

  const msgRows = await db
    .select({
      direction: messages.direction,
      bodyText: messages.bodyText,
      bodyHtml: messages.bodyHtml,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.gmailInternalDate));

  const inbound = msgRows.filter((m) => m.direction === "inbound");
  const latestCustomer = inbound[inbound.length - 1] ?? msgRows[msgRows.length - 1];
  const customerMessage = latestCustomer ? bodyOf(latestCustomer) : "";

  // Recent conversation for context (last few messages, labelled).
  const history = msgRows
    .slice(-HISTORY_LIMIT)
    .map((m) => `${m.direction === "outbound" ? "Molly & Stitch" : "Customer"}: ${bodyOf(m)}`)
    .join("\n\n");

  // Retrieve grounding knowledge (scoped to the thread's category).
  const knowledge = await retrieveKnowledge(db, cfg, {
    queryText: `${t.subject ?? ""}\n${customerMessage}`,
    categoryId: t.categoryId,
    k: KNOWLEDGE_K,
  });

  // Tone profile.
  const toneRows = await db
    .select({ content: toneProfile.content })
    .from(toneProfile)
    .where(eq(toneProfile.isActive, true))
    .limit(1);
  const toneText = toneRows[0]?.content ?? null;

  // Shopify order context (read-only; pins a resolved order to the thread).
  const shopCtx: ShopifyContextDTO = hasShopify(cfg)
    ? await resolveThreadShopify(db, cfg, threadId, { persist: true })
    : { found: false, customer: null, orders: [], matchedBy: null };

  const knowledgeBlock = knowledge.length
    ? knowledge
        .map(
          (k, i) =>
            `[${i + 1}] (${k.type}) ${k.question ? `Q: ${k.question}\n` : ""}${k.answer.slice(0, KNOWLEDGE_CHARS)}`,
        )
        .join("\n\n")
    : "(no specific knowledge entries matched)";

  const userContent = `Customer name: ${t.customerName ?? "(unknown)"}
Subject: ${t.subject ?? "(none)"}

LATEST CUSTOMER MESSAGE:
${customerMessage || "(no readable body)"}

CONVERSATION SO FAR:
${history}

RELEVANT KNOWLEDGE (ground your answer in these; do not invent beyond them):
${knowledgeBlock}

SHOPIFY ORDER CONTEXT:
${formatShopifyContext(shopCtx)}

Write the reply now.`;

  const out = await generateStructured<DraftSchemaOut>(cfg, {
    systemPrompt: systemPrompt(toneText),
    userPrompt: userContent,
    schema: DRAFT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "support_reply_draft",
    models: MODELS.draft,
    maxTokens: 2000,
  });

  // Provenance shown as "Draft based on…" and stored for auditing.
  const basedOn: BasedOnItemDTO[] = knowledge.map((k) => ({
    kind: k.type as BasedOnItemDTO["kind"],
    label:
      (k.question?.trim() || k.answer.slice(0, 80)).slice(0, 90) +
      (k.answer.length > 80 ? "…" : ""),
    detail: null,
  }));
  if (shopCtx.found) {
    for (const o of shopCtx.orders) {
      basedOn.push({
        kind: "order",
        label: `Order ${o.name}`,
        detail: `${o.financialStatus ?? "?"}/${o.fulfillmentStatus ?? "?"}`,
      });
    }
  }
  if (toneText) basedOn.push({ kind: "tone", label: "Brand tone profile", detail: null });

  const primary = configuredAiProviders(cfg)[0];
  const modelId = primary ? MODELS.draft[primary] : null;
  const recommendedAction = out.recommended_action?.trim() || null;
  const confidence: ConfidenceLevel =
    out.confidence === "high" || out.confidence === "low" ? out.confidence : "medium";

  // Supersede any prior pending draft for this thread.
  await db
    .update(drafts)
    .set({ status: "superseded", updatedAt: new Date() })
    .where(and(eq(drafts.threadId, threadId), eq(drafts.status, "pending")));

  const inserted = await db
    .insert(drafts)
    .values({
      threadId,
      body: out.reply_body.trim(),
      categoryId: t.categoryId,
      confidence,
      status: "pending",
      basedOn,
      recommendedAction,
      modelId,
      promptVersion: DRAFT_PROMPT_VERSION,
    })
    .returning();

  // Move the thread into the review queue and reflect the draft's confidence.
  // Backfill the request summary if triage hasn't produced one yet (free — the
  // drafting model already read the whole thread).
  const backfillSummary =
    !t.summary && out.request_summary?.trim()
      ? out.request_summary.trim().slice(0, 280)
      : t.summary;
  await db
    .update(threads)
    .set({
      status: "needs_review",
      confidence,
      summary: backfillSummary,
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId));

  return inserted[0]!;
}
