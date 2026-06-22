import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { senderRules } from "@ms/db";
import { SENDER_RULE_KINDS, type SenderRuleKind } from "@ms/shared";
import { requireAuth } from "../auth";

// Normalize a user-entered pattern: a bare domain becomes "*@domain"; a full
// address or an existing "*@domain" pattern is kept as-is.
function normalizePattern(raw: string): string {
  const p = raw.trim().toLowerCase();
  if (!p) return p;
  if (p.startsWith("*@")) return p;
  if (p.includes("@")) return p; // full address
  return `*@${p}`; // bare domain
}

export function registerSenderRuleRoutes(app: FastifyInstance): void {
  const { db } = app.appCtx;

  app.get("/sender-rules", { preHandler: requireAuth }, async (_req, reply) => {
    const rows = await db
      .select()
      .from(senderRules)
      .orderBy(asc(senderRules.rule), asc(senderRules.pattern));
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        pattern: r.pattern,
        rule: r.rule as SenderRuleKind,
        note: r.note,
      })),
    );
  });

  app.post<{ Body: { pattern?: string; rule?: string; note?: string } }>(
    "/sender-rules",
    { preHandler: requireAuth },
    async (request, reply) => {
      const pattern = normalizePattern(request.body?.pattern ?? "");
      const rule = request.body?.rule;
      if (!pattern || pattern === "*@") {
        return reply.code(400).send({ error: "A pattern is required" });
      }
      if (!SENDER_RULE_KINDS.includes(rule as SenderRuleKind)) {
        return reply.code(400).send({ error: "rule must be allow or block" });
      }
      const inserted = await db
        .insert(senderRules)
        .values({
          pattern,
          rule: rule as SenderRuleKind,
          note: request.body?.note ?? null,
        })
        .onConflictDoUpdate({
          target: senderRules.pattern,
          set: { rule: rule as SenderRuleKind, note: request.body?.note ?? null },
        })
        .returning();
      return reply.send(inserted[0]);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/sender-rules/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      await db.delete(senderRules).where(eq(senderRules.id, request.params.id));
      return reply.send({ ok: true });
    },
  );
}
