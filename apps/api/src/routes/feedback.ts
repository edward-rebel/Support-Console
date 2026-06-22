import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { feedback, type Feedback } from "@ms/db";
import { triageFeedback } from "@ms/integrations";
import {
  FEEDBACK_STATUSES,
  type FeedbackDTO,
  type FeedbackStatus,
  type FeedbackType,
} from "@ms/shared";
import { requireAuth } from "../auth";

function toDTO(f: Feedback): FeedbackDTO {
  return {
    id: f.id,
    message: f.message,
    title: f.title,
    type: f.type as FeedbackType | null,
    page: f.page,
    status: f.status as FeedbackStatus,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function registerFeedbackRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;

  // Submit feedback. AI-triages the free text into a type + title; stores it
  // tagged with the page the user was on.
  app.post<{ Body: { message?: string; page?: string } }>(
    "/feedback",
    { preHandler: requireAuth },
    async (request, reply) => {
      const message = request.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "Feedback can't be empty." });
      const page = request.body?.page?.slice(0, 200) ?? null;

      const triaged = await triageFeedback(cfg, message).catch(() => null);
      const inserted = await db
        .insert(feedback)
        .values({
          message: message.slice(0, 4000),
          title: triaged?.title ?? null,
          type: triaged?.type ?? null,
          page,
          status: "open",
          createdByUserId: request.session.userId ?? null,
        })
        .returning();
      return reply.send(toDTO(inserted[0]!));
    },
  );

  // List feedback, newest first, optionally filtered by status.
  app.get<{ Querystring: { status?: string } }>(
    "/feedback",
    { preHandler: requireAuth },
    async (request, reply) => {
      const status = request.query.status;
      const rows = await db
        .select()
        .from(feedback)
        .where(
          FEEDBACK_STATUSES.includes(status as FeedbackStatus)
            ? eq(feedback.status, status as FeedbackStatus)
            : undefined,
        )
        .orderBy(desc(feedback.createdAt));
      return reply.send(rows.map(toDTO));
    },
  );

  // Counts for the nav badge.
  app.get("/feedback/counts", { preHandler: requireAuth }, async (_req, reply) => {
    const rows = await db
      .select({ status: feedback.status })
      .from(feedback);
    const open = rows.filter((r) => r.status === "open").length;
    return reply.send({ open, total: rows.length });
  });

  // Update status (mark addressed / dismissed / reopen).
  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    "/feedback/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const status = request.body?.status;
      if (!FEEDBACK_STATUSES.includes(status as FeedbackStatus)) {
        return reply.code(400).send({ error: "Invalid status." });
      }
      const updated = await db
        .update(feedback)
        .set({ status: status as FeedbackStatus, updatedAt: new Date() })
        .where(eq(feedback.id, request.params.id))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: "Not found." });
      return reply.send(toDTO(updated[0]));
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/feedback/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      await db.delete(feedback).where(eq(feedback.id, request.params.id));
      return reply.send({ ok: true });
    },
  );
}
