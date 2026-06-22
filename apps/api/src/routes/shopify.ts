import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import {
  extractOrderNumber,
  getShopifyContext,
  hasShopify,
} from "@ms/integrations";
import { messages, threads } from "@ms/db";
import type { ShopifyContextDTO } from "@ms/shared";
import { requireAuth } from "../auth";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
      const rows = await db
        .select({
          id: threads.id,
          email: threads.customerEmail,
          subject: threads.subject,
          pinned: threads.shopifyOrderName,
        })
        .from(threads)
        .where(eq(threads.id, request.params.id))
        .limit(1);
      const t = rows[0];
      if (!t) return reply.code(404).send({ error: "Thread not found" });

      const reply404: ShopifyContextDTO = {
        found: false,
        customer: null,
        orders: [],
        matchedBy: null,
      };

      try {
        // 1) A previously pinned order is authoritative.
        if (t.pinned) {
          const ctx = await getShopifyContext(cfg, { orderNumber: t.pinned });
          if (ctx.found) return reply.send({ ...ctx, matchedBy: "pinned" });
        }

        // 2) Match on the customer's email (preferred default).
        if (t.email) {
          const ctx = await getShopifyContext(cfg, { email: t.email });
          if (ctx.found && ctx.orders.length > 0) {
            return reply.send({ ...ctx, matchedBy: "email" });
          }
        }

        // 3) Fall back to an order number found in the subject or body — covers
        //    customers who email from a different address than their order used.
        const msgs = await db
          .select({
            subject: messages.subject,
            bodyText: messages.bodyText,
            bodyHtml: messages.bodyHtml,
          })
          .from(messages)
          .where(eq(messages.threadId, t.id))
          .orderBy(asc(messages.gmailInternalDate));

        const haystacks = [
          t.subject ?? "",
          ...msgs.map((m) => m.subject ?? ""),
          ...msgs.map((m) =>
            m.bodyText?.trim() ? m.bodyText : m.bodyHtml ? stripHtml(m.bodyHtml) : "",
          ),
        ];
        let orderNo: string | null = null;
        for (const h of haystacks) {
          orderNo = extractOrderNumber(h);
          if (orderNo) break;
        }

        if (orderNo) {
          const ctx = await getShopifyContext(cfg, { orderNumber: orderNo });
          if (ctx.found) {
            const name = ctx.orders[0]?.name ?? orderNo;
            await db
              .update(threads)
              .set({ shopifyOrderName: name, updatedAt: new Date() })
              .where(eq(threads.id, t.id));
            return reply.send({ ...ctx, matchedBy: "order" });
          }
        }

        return reply.send(reply404);
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
