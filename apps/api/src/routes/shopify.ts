import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  getShopifyContext,
  hasShopify,
  resolveThreadShopify,
  searchShopify,
} from "@ms/integrations";
import { threads } from "@ms/db";
import { requireAuth } from "../auth";

// Read-only Shopify lookups. Brings order/customer context into a thread by
// email or order number. No write path exists anywhere (spec invariant).
export function registerShopifyRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;

  app.get("/shopify/status", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({
      configured: hasShopify(cfg),
      store: cfg.shopify?.storeDomain ?? null,
    });
  });

  // Ad-hoc lookup by email or order (not thread-scoped, no persistence).
  app.get<{ Querystring: { email?: string; order?: string } }>(
    "/shopify/context",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!hasShopify(cfg)) {
        return reply.code(400).send({ error: "Shopify is not configured." });
      }
      const { email, order } = request.query;
      if (!email && !order) {
        return reply.code(400).send({ error: "Provide an email or order number." });
      }
      try {
        const context = await getShopifyContext(cfg, {
          email: email ?? null,
          orderNumber: order ?? null,
        });
        return reply.send(context);
      } catch (err) {
        app.log.error({ err }, "Shopify lookup failed");
        return reply.code(502).send({ error: "Shopify lookup failed." });
      }
    },
  );

  // Thread-scoped resolution: pinned order → customer email → order number found
  // in the subject/body. Persists a resolved order so it survives a reload.
  app.get<{ Params: { id: string } }>(
    "/threads/:id/shopify",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!hasShopify(cfg)) {
        return reply.code(400).send({ error: "Shopify is not configured." });
      }
      try {
        const ctx = await resolveThreadShopify(db, cfg, request.params.id, {
          persist: true,
        });
        return reply.send(ctx);
      } catch (err) {
        app.log.error({ err }, "Thread Shopify resolution failed");
        return reply.code(502).send({ error: "Shopify lookup failed." });
      }
    },
  );

  // Manual lookup for a thread by email, name, phone, or order number — pins a
  // resolved order so the context persists on reload. Accepts `query` (new) or
  // `order` (legacy) for backward compatibility.
  app.post<{ Params: { id: string }; Body: { query?: string; order?: string } }>(
    "/threads/:id/shopify/order",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!hasShopify(cfg)) {
        return reply.code(400).send({ error: "Shopify is not configured." });
      }
      const term = (request.body?.query ?? request.body?.order)?.trim();
      if (!term) {
        return reply
          .code(400)
          .send({ error: "Enter an email, name, phone, or order number." });
      }
      try {
        const ctx = await searchShopify(cfg, term);
        if (ctx.found && ctx.orders[0]?.name) {
          await db
            .update(threads)
            .set({ shopifyOrderName: ctx.orders[0].name, updatedAt: new Date() })
            .where(eq(threads.id, request.params.id));
        }
        const matchedBy = !ctx.found
          ? null
          : term.includes("@")
            ? "email"
            : /^#?\d{3,7}$/.test(term.replace(/\s/g, ""))
              ? "order"
              : null;
        return reply.send({ ...ctx, matchedBy });
      } catch (err) {
        app.log.error({ err }, "Shopify lookup failed");
        return reply.code(502).send({ error: "Shopify lookup failed." });
      }
    },
  );
}
