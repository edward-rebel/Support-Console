import type { FastifyInstance } from "fastify";
import { and, desc, eq, ne } from "drizzle-orm";
import { drafts, type Draft } from "@ms/db";
import { generateDraft, sendReply, GmailSendError } from "@ms/integrations";
import type {
  BasedOnItemDTO,
  ConfidenceLevel,
  DraftDTO,
  DraftStatus,
  SendResultDTO,
} from "@ms/shared";
import { requireAuth } from "../auth";

function toDraftDTO(d: Draft): DraftDTO {
  return {
    id: d.id,
    threadId: d.threadId,
    body: d.body,
    confidence: (d.confidence as ConfidenceLevel | null) ?? null,
    status: d.status as DraftStatus,
    basedOn: Array.isArray(d.basedOn) ? (d.basedOn as BasedOnItemDTO[]) : [],
    recommendedAction: d.recommendedAction ?? null,
    modelId: d.modelId ?? null,
    promptVersion: d.promptVersion ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function registerDraftRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;

  // The current active draft for a thread (most recent non-superseded), or null.
  app.get<{ Params: { id: string } }>(
    "/threads/:id/draft",
    { preHandler: requireAuth },
    async (request, reply) => {
      const rows = await db
        .select()
        .from(drafts)
        .where(
          and(
            eq(drafts.threadId, request.params.id),
            ne(drafts.status, "superseded"),
          ),
        )
        .orderBy(desc(drafts.createdAt))
        .limit(1);
      const d = rows[0];
      return reply.send(d ? toDraftDTO(d) : null);
    },
  );

  // Generate (or regenerate) a draft. Never sends.
  app.post<{ Params: { id: string } }>(
    "/threads/:id/draft",
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const d = await generateDraft(db, cfg, request.params.id);
        return reply.send(toDraftDTO(d));
      } catch (err) {
        app.log.error({ err }, "Draft generation failed");
        const msg = err instanceof Error ? err.message : "Draft generation failed";
        return reply.code(400).send({ error: msg });
      }
    },
  );

  // Edit a draft body (operator). Stays pending.
  app.patch<{ Params: { id: string }; Body: { body?: string } }>(
    "/drafts/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = request.body?.body;
      if (!body || !body.trim()) {
        return reply.code(400).send({ error: "body is required" });
      }
      const updated = await db
        .update(drafts)
        .set({ body, updatedAt: new Date() })
        .where(eq(drafts.id, request.params.id))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: "Draft not found" });
      return reply.send(toDraftDTO(updated[0]));
    },
  );

  // Dismiss a draft (operator decides not to reply with it).
  app.post<{ Params: { id: string } }>(
    "/drafts/:id/dismiss",
    { preHandler: requireAuth },
    async (request, reply) => {
      const updated = await db
        .update(drafts)
        .set({ status: "dismissed", updatedAt: new Date() })
        .where(eq(drafts.id, request.params.id))
        .returning();
      if (!updated[0]) return reply.code(404).send({ error: "Draft not found" });
      return reply.send(toDraftDTO(updated[0]));
    },
  );

  // Approve & send — THE guarded send path. A human action on a specific draft.
  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    "/drafts/:id/approve-send",
    { preHandler: requireAuth },
    async (request, reply) => {
      const rows = await db
        .select()
        .from(drafts)
        .where(eq(drafts.id, request.params.id))
        .limit(1);
      const d = rows[0];
      if (!d) return reply.code(404).send({ error: "Draft not found" });
      const finalBody = request.body?.body?.trim() || d.body;
      try {
        const result = await sendReply(db, cfg, {
          threadId: d.threadId,
          draftId: d.id,
          body: finalBody,
          userId: request.session.userId ?? null,
        });
        const dto: SendResultDTO = {
          ok: true,
          sentGmailMessageId: result.sentGmailMessageId,
          sentAt: result.send.sentAt.toISOString(),
        };
        return reply.send(dto);
      } catch (err) {
        if (err instanceof GmailSendError) {
          const code =
            err.reason === "no_send_scope" || err.reason === "not_connected"
              ? 412
              : 400;
          return reply.code(code).send({ error: err.message, reason: err.reason });
        }
        app.log.error({ err }, "Send failed");
        return reply.code(500).send({ error: "Send failed. See server logs." });
      }
    },
  );
}
