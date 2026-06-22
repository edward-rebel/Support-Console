import { and, eq, isNull, sql } from "drizzle-orm";
import {
  categories,
  knowledgeEntries,
  messages,
  threads,
  toneProfile,
  type Db,
} from "@ms/db";
import {
  CATEGORIES,
  EMBEDDING_DIMENSIONS,
  type KnowledgeBuildResult,
} from "@ms/shared";
import type { IntegrationsConfig } from "./config";
import { generateStructured, hasTriageProvider } from "./ai";
import { makeEmbeddingProvider, type EmbeddingProvider } from "./embeddings";

// How many mined examples to feed the distiller per category, and how much of
// each to keep — bounds token spend on the distillation calls.
const EXAMPLES_PER_CATEGORY = 40;
const Q_CHARS = 700;
const A_CHARS = 1000;
const TONE_SAMPLE = 30;
const EMBED_BATCH = 96;

// ── text cleanup ─────────────────────────────────────────────────────────────

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

// Strip quoted history and signatures from a reply so we keep just the brand's
// actual words. Heuristic but good enough for distillation/embedding input.
function extractReplyText(bodyText: string | null, bodyHtml: string | null): string {
  let text = bodyText?.trim() ? bodyText : bodyHtml ? stripHtml(bodyHtml) : "";
  if (!text) return "";
  const cutMarkers = [
    /\nOn .+wrote:/i,
    /\n-----Original Message-----/i,
    /\nFrom:.*Sent:/is,
    /\n_{5,}/,
    /\nGet Outlook for/i,
  ];
  for (const m of cutMarkers) {
    const idx = text.search(m);
    if (idx > 40) text = text.slice(0, idx);
  }
  // Drop quoted lines and a trailing signature block.
  text = text
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n");
  const sig = text.search(/\n--\s*\n/);
  if (sig > 40) text = text.slice(0, sig);
  return text.replace(/\s+/g, " ").trim();
}

// ── mined-example shape ──────────────────────────────────────────────────────

interface MinedRow {
  thread_id: string;
  category_id: string | null;
  q_text: string | null;
  q_html: string | null;
  a_text: string | null;
  a_html: string | null;
}

// First inbound (the customer ask) + first outbound (the brand's reply) per
// customer thread that has both. This is the raw Q→A material.
async function fetchMinedRows(db: Db): Promise<MinedRow[]> {
  return (await db.execute(sql`
    SELECT t.id AS thread_id, t.category_id,
           q.body_text AS q_text, q.body_html AS q_html,
           a.body_text AS a_text, a.body_html AS a_html
    FROM ${threads} t
    JOIN LATERAL (
      SELECT body_text, body_html FROM ${messages}
      WHERE thread_id = t.id AND direction = 'inbound'
      ORDER BY gmail_internal_date ASC NULLS LAST LIMIT 1
    ) q ON true
    JOIN LATERAL (
      SELECT body_text, body_html FROM ${messages}
      WHERE thread_id = t.id AND direction = 'outbound'
      ORDER BY gmail_internal_date ASC NULLS LAST LIMIT 1
    ) a ON true
    WHERE t.is_customer = true
  `)) as unknown as MinedRow[];
}

// ── Stage A: mine deterministic Q→A examples ─────────────────────────────────

async function mineExamples(db: Db): Promise<{ scanned: number; mined: number }> {
  const rows = await fetchMinedRows(db);
  let mined = 0;
  for (const r of rows) {
    const question = extractReplyText(r.q_text, r.q_html).slice(0, 4000);
    const answer = extractReplyText(r.a_text, r.a_html).slice(0, 4000);
    if (question.length < 15 || answer.length < 20) continue;
    const inserted = await db
      .insert(knowledgeEntries)
      .values({
        type: "example",
        categoryId: r.category_id,
        question,
        answer,
        sourceThreadId: r.thread_id,
      })
      .onConflictDoNothing({
        target: knowledgeEntries.sourceThreadId,
        where: sql`source_thread_id IS NOT NULL AND type = 'example'`,
      })
      .returning({ id: knowledgeEntries.id });
    if (inserted.length > 0) mined++;
  }
  return { scanned: rows.length, mined };
}

// ── Stage B: distill canonical answers + policies per category ───────────────

interface DistillOutput {
  canonical: { question: string; answer: string }[];
  policies: { statement: string }[];
}

const DISTILL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    canonical: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          answer: { type: "string" },
        },
        required: ["question", "answer"],
      },
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { statement: { type: "string" } },
        required: ["statement"],
      },
    },
  },
  required: ["canonical", "policies"],
} as const;

const DISTILL_SYSTEM = `You distill a customer-support knowledge base for Molly & Stitch, an e-commerce brand selling handmade leather dog accessories.

You are given real question→answer pairs from the brand's own support history for ONE category. Produce:
- canonical: the recurring customer questions in this category, each with the single best reusable answer, written in the brand's own voice and grounded ONLY in the supplied answers. Merge duplicates. Aim for 3–8 entries.
- policies: concrete, reusable facts/rules the answers reveal (e.g. exchange windows, shipping times, sizing guidance, discount rules). Each a short standalone statement. Aim for 3–10.

Do NOT invent policies or facts not supported by the supplied answers. If the material is thin, return fewer entries. Always call the tool / return the JSON object.`;

async function distillCategory(
  db: Db,
  cfg: IntegrationsConfig,
  categoryId: string,
  categoryName: string,
): Promise<{ canonical: number; policies: number }> {
  const examples = (await db.execute(sql`
    SELECT question, answer FROM ${knowledgeEntries}
    WHERE type = 'example' AND category_id = ${categoryId}
    ORDER BY length(answer) DESC
    LIMIT ${EXAMPLES_PER_CATEGORY}
  `)) as unknown as { question: string; answer: string }[];

  if (examples.length === 0) return { canonical: 0, policies: 0 };

  const corpus = examples
    .map(
      (e, i) =>
        `#${i + 1}\nQ: ${e.question.slice(0, Q_CHARS)}\nA: ${e.answer.slice(0, A_CHARS)}`,
    )
    .join("\n\n");

  const out = await generateStructured<DistillOutput>(cfg, {
    systemPrompt: DISTILL_SYSTEM,
    userPrompt: `Category: ${categoryName}\n\nHistorical Q→A pairs:\n\n${corpus}`,
    schema: DISTILL_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "knowledge_distillation",
  });

  // Regenerate cleanly: drop this category's previously distilled (non-mined)
  // entries so re-runs don't accumulate duplicates. Mined examples (which carry
  // a source_thread_id) are preserved.
  await db
    .delete(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.categoryId, categoryId),
        isNull(knowledgeEntries.sourceThreadId),
        sql`${knowledgeEntries.type} in ('canonical','policy')`,
      ),
    );

  const canonical = (out.canonical ?? []).filter(
    (c) => c.question?.trim() && c.answer?.trim(),
  );
  const policies = (out.policies ?? []).filter((p) => p.statement?.trim());

  if (canonical.length > 0) {
    await db.insert(knowledgeEntries).values(
      canonical.map((c) => ({
        type: "canonical" as const,
        categoryId,
        question: c.question.trim(),
        answer: c.answer.trim(),
      })),
    );
  }
  if (policies.length > 0) {
    await db.insert(knowledgeEntries).values(
      policies.map((p) => ({
        type: "policy" as const,
        categoryId,
        question: null,
        answer: p.statement.trim(),
      })),
    );
  }
  return { canonical: canonical.length, policies: policies.length };
}

// ── Stage C: derive a brand tone profile ─────────────────────────────────────

const TONE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { content: { type: "string" } },
  required: ["content"],
} as const;

const TONE_SYSTEM = `You are a brand-voice analyst. From the real support replies sent by Molly & Stitch (a handmade leather dog-accessory brand), write a concise tone-of-voice profile in Markdown that a writer could follow to draft new replies in the same voice.

Cover: overall tone, greeting/sign-off conventions, formality, warmth, sentence length, use of the customer's/dog's name, emoji usage, and any recurring phrases. Keep it under ~250 words. Ground it only in the supplied replies. Always return the JSON object.`;

async function deriveToneProfile(
  db: Db,
  cfg: IntegrationsConfig,
): Promise<boolean> {
  const replies = (await db.execute(sql`
    SELECT answer FROM ${knowledgeEntries}
    WHERE type = 'example'
    ORDER BY length(answer) DESC
    LIMIT ${TONE_SAMPLE}
  `)) as unknown as { answer: string }[];
  if (replies.length < 3) return false;

  const sample = replies
    .map((r, i) => `Reply #${i + 1}:\n${r.answer.slice(0, 800)}`)
    .join("\n\n");

  const out = await generateStructured<{ content: string }>(cfg, {
    systemPrompt: TONE_SYSTEM,
    userPrompt: `Here are ${replies.length} real support replies:\n\n${sample}`,
    schema: TONE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "tone_profile",
  });
  const content = out.content?.trim();
  if (!content) return false;

  // Keep a single active row; bump version on each rebuild.
  const prev = await db
    .select({ version: toneProfile.version })
    .from(toneProfile)
    .where(eq(toneProfile.isActive, true))
    .limit(1);
  const nextVersion = (prev[0]?.version ?? 0) + 1;
  await db
    .update(toneProfile)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(toneProfile.isActive, true));
  await db
    .insert(toneProfile)
    .values({ content, version: nextVersion, isActive: true });
  return true;
}

// ── Stage D: embed entries that lack a vector ────────────────────────────────

// What text best represents an entry for retrieval: incoming emails match
// against the question for Q&A entries, against the statement for policies.
function embedTextFor(e: {
  type: string;
  question: string | null;
  answer: string;
}): string {
  if (e.type === "policy") return e.answer;
  return e.question?.trim() ? e.question : e.answer;
}

async function embedPending(
  db: Db,
  provider: EmbeddingProvider,
): Promise<number> {
  const pending = (await db
    .select({
      id: knowledgeEntries.id,
      type: knowledgeEntries.type,
      question: knowledgeEntries.question,
      answer: knowledgeEntries.answer,
    })
    .from(knowledgeEntries)
    .where(
      and(isNull(knowledgeEntries.embedding), eq(knowledgeEntries.isActive, true)),
    )) as {
    id: string;
    type: string;
    question: string | null;
    answer: string;
  }[];

  let embedded = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    const vectors = await provider.embed(
      batch.map((e) => embedTextFor(e).slice(0, 8000)),
    );
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (!vec || vec.length !== EMBEDDING_DIMENSIONS) continue;
      await db
        .update(knowledgeEntries)
        .set({ embedding: vec, updatedAt: new Date() })
        .where(eq(knowledgeEntries.id, batch[j]!.id));
      embedded++;
    }
  }
  return embedded;
}

// ── orchestrator ─────────────────────────────────────────────────────────────

export interface BuildOptions {
  onStage?: (stage: string) => void;
}

// Full re-runnable knowledge build: mine → distill → tone → embed. Idempotent
// (mined examples dedupe by source thread; distilled entries are regenerated;
// embeddings fill only nulls). Never sends email; reads only stored data.
export async function buildKnowledgeBase(
  db: Db,
  cfg: IntegrationsConfig,
  opts: BuildOptions = {},
): Promise<KnowledgeBuildResult> {
  const stage = (s: string) => opts.onStage?.(s);
  const result: KnowledgeBuildResult = {
    threadsScanned: 0,
    examplesMined: 0,
    canonicalsWritten: 0,
    policiesWritten: 0,
    toneProfileUpdated: false,
    entriesEmbedded: 0,
  };

  stage("mining examples");
  const mined = await mineExamples(db);
  result.threadsScanned = mined.scanned;
  result.examplesMined = mined.mined;

  if (hasTriageProvider(cfg)) {
    const catRows = await db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories);
    const nameBySlug = new Map(CATEGORIES.map((c) => [c.slug, c.name]));
    for (const cat of catRows) {
      stage(`distilling ${cat.slug}`);
      const d = await distillCategory(
        db,
        cfg,
        cat.id,
        nameBySlug.get(cat.slug) ?? cat.name,
      );
      result.canonicalsWritten += d.canonical;
      result.policiesWritten += d.policies;
    }
    stage("deriving tone profile");
    result.toneProfileUpdated = await deriveToneProfile(db, cfg);
  }

  const provider = makeEmbeddingProvider(cfg);
  if (provider) {
    stage("embedding entries");
    result.entriesEmbedded = await embedPending(db, provider);
  }

  stage("done");
  return result;
}

// Re-embed a single entry (after an operator create/edit). No-op without a
// provider — the entry keeps a null embedding until the next build.
export async function reembedEntry(
  db: Db,
  cfg: IntegrationsConfig,
  entryId: string,
): Promise<boolean> {
  const provider = makeEmbeddingProvider(cfg);
  if (!provider) return false;
  const rows = await db
    .select({
      id: knowledgeEntries.id,
      type: knowledgeEntries.type,
      question: knowledgeEntries.question,
      answer: knowledgeEntries.answer,
    })
    .from(knowledgeEntries)
    .where(eq(knowledgeEntries.id, entryId))
    .limit(1);
  const entry = rows[0];
  if (!entry) return false;
  const [vec] = await provider.embed([embedTextFor(entry).slice(0, 8000)]);
  if (!vec || vec.length !== EMBEDDING_DIMENSIONS) return false;
  await db
    .update(knowledgeEntries)
    .set({ embedding: vec, updatedAt: new Date() })
    .where(eq(knowledgeEntries.id, entryId));
  return true;
}

// ── retrieval (consumed by Phase 3 drafting) ─────────────────────────────────

export interface RetrievedEntry {
  id: string;
  type: string;
  question: string | null;
  answer: string;
  categoryId: string | null;
  similarity: number;
}

// Top-k cosine search over active, embedded entries. Optionally scoped to a
// category; policies for that category are always eligible.
export async function retrieveKnowledge(
  db: Db,
  cfg: IntegrationsConfig,
  params: { queryText: string; categoryId?: string | null; k?: number },
): Promise<RetrievedEntry[]> {
  const provider = makeEmbeddingProvider(cfg);
  if (!provider) return [];
  const text = params.queryText.trim();
  if (!text) return [];

  const [vec] = await provider.embed([text.slice(0, 8000)]);
  if (!vec) return [];
  const literal = `[${vec.join(",")}]`;
  const k = params.k ?? 6;

  const categoryFilter = params.categoryId
    ? sql`AND (category_id = ${params.categoryId} OR category_id IS NULL)`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT id, type, question, answer, category_id AS "categoryId",
           1 - (embedding <=> ${literal}::vector) AS similarity
    FROM ${knowledgeEntries}
    WHERE is_active = true AND embedding IS NOT NULL
    ${categoryFilter}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${k}
  `)) as unknown as RetrievedEntry[];
  return rows;
}
