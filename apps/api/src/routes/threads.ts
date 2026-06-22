import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { categories, messages, threads } from "@ms/db";
import type {
  AttachmentDTO,
  CategoryDTO,
  ConfidenceLevel,
  MessageDTO,
  Paginated,
  Sentiment,
  ThreadDetailDTO,
  ThreadSummaryDTO,
  ThreadStatus,
} from "@ms/shared";
import { SENTIMENTS, THREAD_STATUSES } from "@ms/shared";
import { requireAuth } from "../auth";

function asSentiment(value: string | null): Sentiment | null {
  return SENTIMENTS.includes(value as Sentiment) ? (value as Sentiment) : null;
}

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

// A thread is "unanswered" (Open) when:
//   1. it isn't manually closed, AND
//   2. its most recent message is inbound (the customer wrote last), AND
//   3. we have NOT replied to this same customer at/after that latest inbound
//      message — including replies that landed in a *sibling* Gmail thread.
//
// Condition 3 is what makes the Open list match Gmail: a single customer issue
// often spans multiple Gmail threads (e.g. a duplicate inbound that Gmail
// didn't thread together). If we answered the customer in one thread, the
// duplicate shouldn't keep showing as unanswered. The check is time-aware, so a
// genuine new question — or a follow-up sent *after* our last reply — is still
// Open. Threads with no resolved customer email fall back to rules 1–2.
function unansweredThread(): SQL {
  const lastDirection = sql`(
    select m.direction from messages m
    where m.thread_id = ${threads.id}
    order by coalesce(m.gmail_internal_date, m.created_at) desc, m.id desc
    limit 1
  )`;
  const lastMessageAt = sql`(
    select coalesce(m.gmail_internal_date, m.created_at) from messages m
    where m.thread_id = ${threads.id}
    order by coalesce(m.gmail_internal_date, m.created_at) desc, m.id desc
    limit 1
  )`;
  const repliedToCustomer = sql`exists (
    select 1 from messages om
    join threads ot on ot.id = om.thread_id
    where om.direction = 'outbound'
      and ${threads.customerEmail} is not null
      and lower(ot.customer_email) = lower(${threads.customerEmail})
      and coalesce(om.gmail_internal_date, om.created_at) >= ${lastMessageAt}
  )`;
  return sql`(${threads.status} <> 'closed' and ${lastDirection} = 'inbound' and not ${repliedToCustomer})`;
}

export function registerThreadRoutes(app: FastifyInstance): void {
  const { db } = app.appCtx;

  // GET /threads?status=needs_review&page=1&pageSize=50
  app.get<{
    Querystring: {
      status?: string;
      tab?: string;
      category?: string;
      q?: string;
      page?: string;
      pageSize?: string;
    };
  }>("/threads", { preHandler: requireAuth }, async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize ?? "50") || 50),
    );
    const statusParam = request.query.status;

    const conds: SQL[] = [];
    // "open" is a virtual filter: genuinely unanswered requests (see
    // unansweredThread). Otherwise an exact status match.
    if (statusParam === "open") {
      conds.push(unansweredThread());
    } else if (THREAD_STATUSES.includes(statusParam as ThreadStatus)) {
      conds.push(eq(threads.status, statusParam as ThreadStatus));
    }
    // Triage tab: "noise" = filtered out (is_customer false); "customer" =
    // confirmed customers + not-yet-triaged (is_customer true or null).
    if (request.query.tab === "noise") {
      conds.push(eq(threads.isCustomer, false));
    } else if (request.query.tab === "customer") {
      conds.push(or(eq(threads.isCustomer, true), isNull(threads.isCustomer))!);
    }
    if (request.query.category) {
      conds.push(eq(categories.slug, request.query.category));
    }
    // Free-text search across subject + customer name/email.
    const q = request.query.q?.trim();
    if (q) {
      const like = `%${q}%`;
      conds.push(
        or(
          ilike(threads.subject, like),
          ilike(threads.customerName, like),
          ilike(threads.customerEmail, like),
        )!,
      );
    }
    const where = conds.length ? and(...conds) : undefined;

    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(threads)
      .leftJoin(categories, eq(threads.categoryId, categories.id))
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
        sentiment: threads.sentiment,
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
      // Unique tiebreaker so offset-based "Load more" can't duplicate/skip rows
      // when lastMessageAt is null or shared across threads.
      .orderBy(sql`${threads.lastMessageAt} desc nulls last`, desc(threads.id))
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
      sentiment: asSentiment(r.sentiment),
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

  // GET /threads/counts — tab + subtitle badges for the inbox.
  app.get(
    "/threads/counts",
    { preHandler: requireAuth },
    async (_request, reply) => {
      const rows = await db
        .select({
          customer: sql<number>`count(*) filter (where ${threads.isCustomer} is true or ${threads.isCustomer} is null)::int`,
          noise: sql<number>`count(*) filter (where ${threads.isCustomer} is false)::int`,
          pending: sql<number>`count(*) filter (where ${threads.isCustomer} is null)::int`,
          // "Open" = customer requests still genuinely unanswered.
          open: sql<number>`count(*) filter (where (${threads.isCustomer} is true or ${threads.isCustomer} is null) and ${unansweredThread()})::int`,
        })
        .from(threads);
      const r = rows[0];
      const open = r?.open ?? 0;
      return reply.send({
        customer: r?.customer ?? 0,
        noise: r?.noise ?? 0,
        pending: r?.pending ?? 0,
        open,
        // Back-compat alias for the nav badge / subtitle (now the open count).
        needsReview: open,
      });
    },
  );

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
          sentiment: threads.sentiment,
          summary: threads.summary,
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

      // Explicit columns (skip the heavy raw jsonb), and a deterministic order:
      // null-dated or same-dated messages fall back to insert time, then id.
      const msgRows = await db
        .select({
          id: messages.id,
          threadId: messages.threadId,
          direction: messages.direction,
          fromAddress: messages.fromAddress,
          toAddress: messages.toAddress,
          subject: messages.subject,
          bodyText: messages.bodyText,
          bodyHtml: messages.bodyHtml,
          gmailInternalDate: messages.gmailInternalDate,
          attachments: messages.attachments,
        })
        .from(messages)
        .where(eq(messages.threadId, id))
        .orderBy(
          asc(sql`coalesce(${messages.gmailInternalDate}, ${messages.createdAt})`),
          asc(messages.id),
        );

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
        attachments: Array.isArray(m.attachments)
          ? (m.attachments as Omit<AttachmentDTO, "messageId">[]).map((a) => ({
              ...a,
              messageId: m.id,
            }))
          : [],
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
        sentiment: asSentiment(t.sentiment),
        summary: t.summary,
        unread: t.status === "new",
        snippet: t.snippet,
        lastMessageAt: t.lastMessageAt ? t.lastMessageAt.toISOString() : null,
        messages: msgs,
      };
      return reply.send(detail);
    },
  );

  // Manually close a request without sending a reply (e.g. customer said
  // "thanks, got it"). Closed threads drop out of Open and Sent but remain
  // under All. Does not send anything.
  app.post<{ Params: { id: string } }>(
    "/threads/:id/close",
    { preHandler: requireAuth },
    async (request, reply) => {
      const updated = await db
        .update(threads)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(threads.id, request.params.id))
        .returning({ id: threads.id, status: threads.status });
      if (!updated[0]) return reply.code(404).send({ error: "Thread not found" });
      return reply.send({ ok: true, status: updated[0].status });
    },
  );

  // Reopen a closed thread back to the unanswered queue.
  app.post<{ Params: { id: string } }>(
    "/threads/:id/reopen",
    { preHandler: requireAuth },
    async (request, reply) => {
      const updated = await db
        .update(threads)
        .set({ status: "new", updatedAt: new Date() })
        .where(eq(threads.id, request.params.id))
        .returning({ id: threads.id, status: threads.status });
      if (!updated[0]) return reply.code(404).send({ error: "Thread not found" });
      return reply.send({ ok: true, status: updated[0].status });
    },
  );
}
