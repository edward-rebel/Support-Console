import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  getShopifyContext,
  hasShopify,
  resolveThreadShopify,
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

  // Manual order lookup for a thread — pins the order so it persists on reload.
  app.post<{ Params: { id: string }; Body: { order?: string } }>(
    "/threads/:id/shopify/order",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!hasShopify(cfg)) {
        return reply.code(400).send({ error: "Shopify is not configured." });
      }
      const order = request.body?.order?.trim();
      if (!order) return reply.code(400).send({ error: "An order number is required." });
      try {
        const ctx = await getShopifyContext(cfg, { orderNumber: order });
        if (ctx.found) {
          const name = ctx.orders[0]?.name ?? `#${order.replace(/^#/, "")}`;
          await db
            .update(threads)
            .set({ shopifyOrderName: name, updatedAt: new Date() })
            .where(eq(threads.id, request.params.id));
        }
        return reply.send({ ...ctx, matchedBy: ctx.found ? "order" : null });
      } catch (err) {
        app.log.error({ err }, "Shopify order lookup failed");
        return reply.code(502).send({ error: "Shopify lookup failed." });
      }
    },
  );
}
