import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  buildKnowledgeBase,
  hasEmbeddingProvider,
  reembedEntry,
  type IntegrationsConfig,
} from "@ms/integrations";
import {
  categories,
  knowledgeEntries,
  toneProfile,
  type Db,
} from "@ms/db";
import {
  KNOWLEDGE_ENTRY_TYPES,
  type CategoryDTO,
  type KnowledgeBuildResult,
  type KnowledgeEntryDTO,
  type KnowledgeEntryType,
} from "@ms/shared";
import { requireAuth } from "../auth";

// Single-flight build runner (mirrors TriageRunner). The build mines history,
// distills with the strong model, derives tone, and embeds — re-runnable and
// idempotent; never sends email.
class KnowledgeBuildRunner {
  private running = false;
  private stage: string | null = null;
  private lastResult: KnowledgeBuildResult | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly cfg: IntegrationsConfig,
  ) {}

  get state() {
    return {
      running: this.running,
      stage: this.stage,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  start(log: (msg: string, err?: unknown) => void): boolean {
    if (this.running) return false;
    this.running = true;
    this.lastError = null;
    this.stage = "starting";
    void (async () => {
      try {
        this.lastResult = await buildKnowledgeBase(this.db, this.cfg, {
          onStage: (s) => {
            this.stage = s;
            log(`Knowledge build: ${s}`);
          },
        });
        log(
          `Knowledge build complete: ${this.lastResult.examplesMined} examples, ${this.lastResult.canonicalsWritten} canonical, ${this.lastResult.policiesWritten} policies, ${this.lastResult.entriesEmbedded} embedded`,
        );
      } catch (err) {
        this.lastError = "Knowledge build failed. See server logs.";
        log("Knowledge build failed", err);
      } finally {
        this.running = false;
        this.stage = null;
      }
    })();
    return true;
  }
}

function toCategoryDTO(row: {
  id: string | null;
  slug: string | null;
  name: string | null;
  color: string | null;
}): CategoryDTO | null {
  if (!row.id || !row.slug || !row.name || !row.color) return null;
  return { id: row.id, slug: row.slug, name: row.name, color: row.color };
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;
  const runner = new KnowledgeBuildRunner(db, cfg);

  // List entries (optionally filtered by type/category slug).
  app.get<{ Querystring: { type?: string; category?: string } }>(
    "/knowledge",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { type, category } = request.query;
      const filters = [];
      if (type && KNOWLEDGE_ENTRY_TYPES.includes(type as KnowledgeEntryType)) {
        filters.push(eq(knowledgeEntries.type, type));
      }
      if (category) {
        filters.push(eq(categories.slug, category));
      }
      const rows = await db
        .select({
          id: knowledgeEntries.id,
          type: knowledgeEntries.type,
          question: knowledgeEntries.question,
          answer: knowledgeEntries.answer,
          sourceThreadId: knowledgeEntries.sourceThreadId,
          isActive: knowledgeEntries.isActive,
          embedding: knowledgeEntries.embedding,
          createdAt: knowledgeEntries.createdAt,
          updatedAt: knowledgeEntries.updatedAt,
          catId: categories.id,
          catSlug: categories.slug,
          catName: categories.name,
          catColor: categories.color,
        })
        .from(knowledgeEntries)
        .leftJoin(categories, eq(knowledgeEntries.categoryId, categories.id))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(knowledgeEntries.type), desc(knowledgeEntries.updatedAt));

      const items: KnowledgeEntryDTO[] = rows.map((r) => ({
        id: r.id,
        type: r.type as KnowledgeEntryType,
        category: toCategoryDTO({
          id: r.catId,
          slug: r.catSlug,
          name: r.catName,
          color: r.catColor,
        }),
        question: r.question,
        answer: r.answer,
        sourceThreadId: r.sourceThreadId,
        isActive: r.isActive,
        embedded: r.embedding != null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
      return reply.send(items);
    },
  );

  // Counts + build status (drives the KB screen header).
  app.get(
    "/knowledge/build/status",
    { preHandler: requireAuth },
    async (_req, reply) => {
      const counts = await db
        .select({
          type: knowledgeEntries.type,
          total: sql<number>`count(*)::int`,
          unembedded: sql<number>`count(*) filter (where embedding is null)::int`,
        })
        .from(knowledgeEntries)
        .groupBy(knowledgeEntries.type);
      const byType = { canonical: 0, example: 0, policy: 0 };
      let unembedded = 0;
      for (const c of counts) {
        if (c.type in byType) byType[c.type as keyof typeof byType] = c.total;
        unembedded += c.unembedded;
      }
      const tone = await db
        .select({ id: toneProfile.id })
        .from(toneProfile)
        .where(eq(toneProfile.isActive, true))
        .limit(1);
      return reply.send({
        ...runner.state,
        configured: hasEmbeddingProvider(cfg),
        counts: { ...byType, unembedded },
        hasTone: tone.length > 0,
      });
    },
  );

  // Kick a build.
  app.post(
    "/knowledge/build",
    { preHandler: requireAuth },
    async (_req, reply) => {
      if (!hasEmbeddingProvider(cfg)) {
        return reply
          .code(400)
          .send({ error: "No embeddings/AI provider key is configured." });
      }
      const started = runner.start((msg, err) => {
        if (err) app.log.error({ err }, msg);
        else app.log.info(msg);
      });
      return reply.send({ started, ...runner.state });
    },
  );

  // Tone profile (single active row).
  app.get("/knowledge/tone", { preHandler: requireAuth }, async (_req, reply) => {
    const rows = await db
      .select()
      .from(toneProfile)
      .where(eq(toneProfile.isActive, true))
      .limit(1);
    const t = rows[0];
    return reply.send(
      t
        ? {
            id: t.id,
            content: t.content,
            version: t.version,
            updatedAt: t.updatedAt.toISOString(),
          }
        : null,
    );
  });

  app.put<{ Body: { content?: string } }>(
    "/knowledge/tone",
    { preHandler: requireAuth },
    async (request, reply) => {
      const content = request.body?.content?.trim();
      if (!content) return reply.code(400).send({ error: "content is required" });
      const existing = await db
        .select({ id: toneProfile.id, version: toneProfile.version })
        .from(toneProfile)
        .where(eq(toneProfile.isActive, true))
        .limit(1);
      if (existing[0]) {
        await db
          .update(toneProfile)
          .set({ content, updatedAt: new Date() })
          .where(eq(toneProfile.id, existing[0].id));
      } else {
        await db.insert(toneProfile).values({ content, version: 1, isActive: true });
      }
      return reply.send({ ok: true });
    },
  );

  // Create an entry by hand. Embeds immediately when a provider is configured.
  app.post<{
    Body: { type?: string; categorySlug?: string; question?: string; answer?: string };
  }>("/knowledge", { preHandler: requireAuth }, async (request, reply) => {
    const { type, categorySlug, question, answer } = request.body ?? {};
    if (!type || !KNOWLEDGE_ENTRY_TYPES.includes(type as KnowledgeEntryType)) {
      return reply.code(400).send({ error: "type must be canonical, example, or policy" });
    }
    if (!answer?.trim()) {
      return reply.code(400).send({ error: "answer is required" });
    }
    let categoryId: string | null = null;
    if (categorySlug) {
      const cat = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, categorySlug))
        .limit(1);
      categoryId = cat[0]?.id ?? null;
    }
    const inserted = await db
      .insert(knowledgeEntries)
      .values({
        type: type as KnowledgeEntryType,
        categoryId,
        question: question?.trim() || null,
        answer: answer.trim(),
      })
      .returning({ id: knowledgeEntries.id });
    const id = inserted[0]!.id;
    await reembedEntry(db, cfg, id).catch((err) =>
      app.log.error({ err }, "Failed to embed new knowledge entry"),
    );
    return reply.send({ id });
  });

  // Edit an entry. Re-embeds when the text changed.
  app.patch<{
    Params: { id: string };
    Body: { question?: string; answer?: string; isActive?: boolean };
  }>("/knowledge/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { question, answer, isActive } = request.body ?? {};
    const set: Record<string, unknown> = { updatedAt: new Date() };
    let textChanged = false;
    if (question !== undefined) {
      set.question = question?.trim() || null;
      textChanged = true;
    }
    if (answer !== undefined) {
      if (!answer.trim()) return reply.code(400).send({ error: "answer cannot be empty" });
      set.answer = answer.trim();
      textChanged = true;
    }
    if (isActive !== undefined) set.isActive = isActive;
    // Clear the stale vector when the text changed so retrieval never uses an
    // embedding that no longer matches the words.
    if (textChanged) set.embedding = null;

    const updated = await db
      .update(knowledgeEntries)
      .set(set)
      .where(eq(knowledgeEntries.id, request.params.id))
      .returning({ id: knowledgeEntries.id });
    if (updated.length === 0) return reply.code(404).send({ error: "Not found" });
    if (textChanged) {
      await reembedEntry(db, cfg, request.params.id).catch((err) =>
        app.log.error({ err }, "Failed to re-embed knowledge entry"),
      );
    }
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>(
    "/knowledge/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      await db
        .delete(knowledgeEntries)
        .where(eq(knowledgeEntries.id, request.params.id));
      return reply.send({ ok: true });
    },
  );
}
