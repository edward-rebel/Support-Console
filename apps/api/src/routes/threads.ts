import type { FastifyInstance } from "fastify";
import { asc, desc, eq, sql } from "drizzle-orm";
import { categories, messages, threads } from "@ms/db";
import type {
  CategoryDTO,
  ConfidenceLevel,
  MessageDTO,
  Paginated,
  ThreadDetailDTO,
  ThreadSummaryDTO,
  ThreadStatus,
} from "@ms/shared";
import { THREAD_STATUSES } from "@ms/shared";
import { requireAuth } from "../auth";

function toCategoryDTO(
  row: {
    id: string | null;
    slug: string | null;
    name: string | null;
    color: string | null;
  } | null,
): CategoryDTO | null {
  if (!row || !row.id || !row.slug || !row.name || !row.color) return null;
  return { id: row.id, slug: row.slug, name: row.name, color: row.color };
}

function asConfidence(value: string | null): ConfidenceLevel | null {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : null;
}

export function registerThreadRoutes(app: FastifyInstance): void {
  const { db } = app.appCtx;

  // GET /threads?status=needs_review&page=1&pageSize=50
  app.get<{
    Querystring: { status?: string; page?: string; pageSize?: string };
  }>("/threads", { preHandler: requireAuth }, async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize ?? "50") || 50),
    );
    const statusParam = request.query.status;
    const statusFilter = THREAD_STATUSES.includes(statusParam as ThreadStatus)
      ? (statusParam as ThreadStatus)
      : undefined;

    const where = statusFilter ? eq(threads.status, statusFilter) : undefined;

    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(threads)
      .where(where ?? sql`true`);
    const total = countRows[0]?.count ?? 0;

    const rows = await db
      .select({
        id: threads.id,
        subject: threads.subject,
        customerEmail: threads.customerEmail,
        customerName: threads.customerName,
        isCustomer: threads.isCustomer,
        status: threads.status,
        confidence: threads.confidence,
        snippet: threads.snippet,
        lastMessageAt: threads.lastMessageAt,
        catId: categories.id,
        catSlug: categories.slug,
        catName: categories.name,
        catColor: categories.color,
      })
      .from(threads)
      .leftJoin(categories, eq(threads.categoryId, categories.id))
      .where(where ?? sql`true`)
      .orderBy(desc(threads.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items: ThreadSummaryDTO[] = rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      customerEmail: r.customerEmail,
      customerName: r.customerName,
      isCustomer: r.isCustomer,
      category: toCategoryDTO({
        id: r.catId,
        slug: r.catSlug,
        name: r.catName,
        color: r.catColor,
      }),
      status: r.status as ThreadStatus,
      confidence: asConfidence(r.confidence),
      // Phase 0 has no read-tracking; treat a brand-new thread as unread.
      unread: r.status === "new",
      snippet: r.snippet,
      lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    }));

    const result: Paginated<ThreadSummaryDTO> = {
      items,
      total,
      page,
      pageSize,
    };
    return reply.send(result);
  });

  // GET /threads/:id — thread + ordered messages.
  app.get<{ Params: { id: string } }>(
    "/threads/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const id = request.params.id;
      const rows = await db
        .select({
          id: threads.id,
          subject: threads.subject,
          customerEmail: threads.customerEmail,
          customerName: threads.customerName,
          isCustomer: threads.isCustomer,
          status: threads.status,
          confidence: threads.confidence,
          snippet: threads.snippet,
          lastMessageAt: threads.lastMessageAt,
          catId: categories.id,
          catSlug: categories.slug,
          catName: categories.name,
          catColor: categories.color,
        })
        .from(threads)
        .leftJoin(categories, eq(threads.categoryId, categories.id))
        .where(eq(threads.id, id))
        .limit(1);
      const t = rows[0];
      if (!t) return reply.code(404).send({ error: "Thread not found" });

      const msgRows = await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, id))
        .orderBy(asc(messages.gmailInternalDate));

      const msgs: MessageDTO[] = msgRows.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        direction: m.direction as MessageDTO["direction"],
        fromAddress: m.fromAddress,
        toAddress: m.toAddress,
        subject: m.subject,
        bodyText: m.bodyText,
        bodyHtml: m.bodyHtml,
        gmailInternalDate: m.gmailInternalDate
          ? m.gmailInternalDate.toISOString()
          : null,
      }));

      const detail: ThreadDetailDTO = {
        id: t.id,
        subject: t.subject,
        customerEmail: t.customerEmail,
        customerName: t.customerName,
        isCustomer: t.isCustomer,
        category: toCategoryDTO({
          id: t.catId,
          slug: t.catSlug,
          name: t.catName,
          color: t.catColor,
        }),
        status: t.status as ThreadStatus,
        confidence: asConfidence(t.confidence),
        unread: t.status === "new",
        snippet: t.snippet,
        lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
        messages: msgs,
      };
      return reply.send(detail);
    },
  );
}
