import type { FastifyInstance } from "fastify";
import { getShopifyContext, hasShopify } from "@ms/integrations";
import { requireAuth } from "../auth";

// Read-only Shopify lookups. Brings order/customer context into a thread by
// email or order number. No write path exists anywhere (spec invariant).
export function registerShopifyRoutes(app: FastifyInstance): void {
  const { env } = app.appCtx;
  const cfg = env.integrations;

  app.get("/shopify/status", { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({
      configured: hasShopify(cfg),
      store: cfg.shopify?.storeDomain ?? null,
    });
  });

  app.get<{ Querystring: { email?: string; order?: string } }>(
    "/shopify/context",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!hasShopify(cfg)) {
        return reply.code(400).send({ error: "Shopify is not configured." });
      }
      const { email, order } = request.query;
      if (!email && !order) {
        return reply
          .code(400)
          .send({ error: "Provide an email or order number." });
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
}
