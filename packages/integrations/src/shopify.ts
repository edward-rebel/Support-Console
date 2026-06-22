import { asc, eq } from "drizzle-orm";
import { messages, threads, type Db } from "@ms/db";
import type { IntegrationsConfig, ShopifyConfig } from "./config";
import type { ShopifyContextDTO, ShopifyOrderDTO } from "@ms/shared";

// ── Read-only Shopify integration (Phase 4) ──────────────────────────────────
// Brings order/customer context into a thread. STRICTLY READ-ONLY: this module
// only ever issues GraphQL queries (no mutations) — the spec forbids any write
// to Shopify. Recommended actions are surfaced as text for the human to act on.

export function hasShopify(cfg: IntegrationsConfig): boolean {
  return Boolean(
    cfg.shopify?.storeDomain && cfg.shopify.apiKey && cfg.shopify.apiSecret,
  );
}

// Pull a Shopify order number out of free text (email subject/body). Requires a
// "#" prefix or an "order …" cue so bare 5-digit numbers (zip codes, etc.) don't
// false-match. Returns the order name with a leading "#", or null.
export function extractOrderNumber(text: string | null | undefined): string | null {
  if (!text) return null;
  const hash = text.match(/#\s?(\d{4,7})\b/);
  if (hash) return `#${hash[1]}`;
  const ord = text.match(/orders?\s*(?:no\.?|number|num)?[:#\s]*(\d{4,7})\b/i);
  if (ord) return `#${ord[1]}`;
  return null;
}

// ── token manager ────────────────────────────────────────────────────────────
// Shopify's client-credentials grant returns a ~24h Admin API token with NO
// refresh token. We mint on demand and cache in memory per store, re-minting a
// minute before expiry (or when a query 401s). Nothing is persisted.
interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, CachedToken>();
const EXPIRY_MARGIN_MS = 60_000;

async function mintToken(s: ShopifyConfig): Promise<CachedToken> {
  const res = await fetch(`https://${s.storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: s.apiKey,
      client_secret: s.apiSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Shopify token grant failed (${res.status})`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Shopify token grant returned no token");
  return {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 86_400) * 1000,
  };
}

async function getToken(s: ShopifyConfig, forceRefresh = false): Promise<string> {
  const cached = tokenCache.get(s.storeDomain);
  if (
    !forceRefresh &&
    cached &&
    cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return cached.token;
  }
  const fresh = await mintToken(s);
  tokenCache.set(s.storeDomain, fresh);
  return fresh.token;
}

// ── GraphQL client (read-only) ───────────────────────────────────────────────
interface GraphqlResult<T> {
  data?: T;
  errors?: { message: string }[];
}

async function shopifyGraphql<T>(
  s: ShopifyConfig,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const run = async (token: string) =>
    fetch(`https://${s.storeDomain}/admin/api/${s.apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

  let res = await run(await getToken(s));
  // Token may have been invalidated early — re-mint once and retry.
  if (res.status === 401) {
    res = await run(await getToken(s, true));
  }
  if (!res.ok) {
    throw new Error(`Shopify GraphQL request failed (${res.status})`);
  }
  const body = (await res.json()) as GraphqlResult<T>;
  if (body.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) throw new Error("Shopify GraphQL returned no data");
  return body.data;
}

// ── shapes from the Admin GraphQL API ────────────────────────────────────────
interface GqlMoney {
  amount: string;
  currencyCode: string;
}
interface GqlOrderNode {
  name: string;
  createdAt: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: GqlMoney } | null;
  lineItems: { edges: { node: { title: string; quantity: number } }[] };
  fulfillments: {
    trackingInfo: { number: string | null; url: string | null; company: string | null }[];
  }[];
}
interface GqlCustomerNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  numberOfOrders: string | null;
  amountSpent: GqlMoney | null;
  createdAt: string;
  orders: { edges: { node: GqlOrderNode }[] };
}

const ORDER_FIELDS = `
  name
  createdAt
  processedAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 25) { edges { node { title quantity } } }
  fulfillments(first: 10) { trackingInfo { number url company } }
`;

function mapOrder(o: GqlOrderNode): ShopifyOrderDTO {
  const tracking = o.fulfillments
    .flatMap((f) => f.trackingInfo)
    .filter((t) => t.number || t.url)
    .map((t) => ({ number: t.number, url: t.url, company: t.company }));
  return {
    name: o.name,
    createdAt: o.processedAt ?? o.createdAt,
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    total: o.totalPriceSet?.shopMoney.amount ?? null,
    currency: o.totalPriceSet?.shopMoney.currencyCode ?? null,
    lineItems: o.lineItems.edges.map((e) => ({
      title: e.node.title,
      quantity: e.node.quantity,
    })),
    tracking,
  };
}

function notFound(): ShopifyContextDTO {
  return { found: false, customer: null, orders: [] };
}

// Look up a customer by a Shopify customers-query string (e.g. "email:x@y.com",
// "phone:+1...", or free text matching name/email/phone) + their recent orders.
async function customerByQuery(s: ShopifyConfig, q: string): Promise<ShopifyContextDTO> {
  const data = await shopifyGraphql<{ customers: { edges: { node: GqlCustomerNode }[] } }>(
    s,
    `query($q: String!) {
      customers(first: 1, query: $q) {
        edges { node {
          id firstName lastName email phone numberOfOrders
          amountSpent { amount currencyCode }
          createdAt
          orders(first: 5, sortKey: CREATED_AT, reverse: true) {
            edges { node { ${ORDER_FIELDS} } }
          }
        } }
      }
    }`,
    { q },
  );
  const c = data.customers.edges[0]?.node;
  if (!c) return notFound();
  return {
    found: true,
    customer: {
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      email: c.email,
      phone: c.phone,
      ordersCount: c.numberOfOrders ? Number(c.numberOfOrders) : c.orders.edges.length,
      totalSpent: c.amountSpent?.amount ?? null,
      currency: c.amountSpent?.currencyCode ?? null,
      createdAt: c.createdAt,
    },
    orders: c.orders.edges.map((e) => mapOrder(e.node)),
  };
}

// Look up a single order by its number (e.g. "#21142" or "21142"); include the
// customer attached to that order.
async function byOrder(s: ShopifyConfig, orderNumber: string): Promise<ShopifyContextDTO> {
  const clean = orderNumber.trim().replace(/^#/, "");
  const data = await shopifyGraphql<{
    orders: { edges: { node: GqlOrderNode & { customer: GqlCustomerNode | null } }[] };
  }>(
    s,
    `query($q: String!) {
      orders(first: 1, query: $q) {
        edges { node {
          ${ORDER_FIELDS}
          customer {
            id firstName lastName email phone numberOfOrders
            amountSpent { amount currencyCode }
            createdAt
            orders(first: 1) { edges { node { name } } }
          }
        } }
      }
    }`,
    { q: `name:#${clean}` },
  );
  const node = data.orders.edges[0]?.node;
  if (!node) return notFound();
  const c = node.customer;
  return {
    found: true,
    customer: c
      ? {
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
          email: c.email,
          phone: c.phone,
          ordersCount: c.numberOfOrders ? Number(c.numberOfOrders) : null,
          totalSpent: c.amountSpent?.amount ?? null,
          currency: c.amountSpent?.currencyCode ?? null,
          createdAt: c.createdAt,
        }
      : null,
    orders: [mapOrder(node)],
  };
}

async function byEmail(s: ShopifyConfig, email: string): Promise<ShopifyContextDTO> {
  return customerByQuery(s, `email:${email}`);
}

// Addresses that are NOT the real customer: Shopify/platform senders, the brand's
// own mailbox, and generic system prefixes. Used both to skip a useless lookup on
// the thread's From and to pick the real customer email out of a form-submission.
const SYSTEM_EMAIL =
  /(@(shopify\.com|[a-z0-9-]+\.shopifyemail\.com|[a-z0-9-]+\.myshopify\.com)$)|(@mollyandstitch\.)|(^(no-?reply|mailer|notifications?|do-?not-?reply|postmaster|mailer-daemon)@)/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function isSystemEmail(email: string | null | undefined): boolean {
  return Boolean(email && SYSTEM_EMAIL.test(email.toLowerCase()));
}

// Pull the first real customer email out of free text (e.g. a Shopify contact-
// form submission that arrives from mailer@shopify.com but contains the real
// customer's address in the body), skipping system/brand addresses.
export function extractCustomerEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const matches = text.match(EMAIL_IN_TEXT) ?? [];
  for (const m of matches) {
    const e = m.toLowerCase();
    if (!SYSTEM_EMAIL.test(e)) return e;
  }
  return null;
}

// Broad manual lookup: route by the shape of the term — email, order number
// (3-7 digits, optionally #-prefixed), or free text (name / phone / etc, which
// Shopify's customer search matches across name/email/phone).
export async function searchShopify(
  cfg: IntegrationsConfig,
  term: string,
): Promise<ShopifyContextDTO> {
  if (!hasShopify(cfg) || !cfg.shopify) throw new Error("Shopify is not configured");
  const t = term.trim();
  if (!t) return notFound();
  if (t.includes("@")) return byEmail(cfg.shopify, t.toLowerCase());
  if (/^#?\d{3,7}$/.test(t.replace(/\s/g, ""))) return byOrder(cfg.shopify, t);
  return customerByQuery(cfg.shopify, t);
}

// Public entry point used by the API + the drafting agent. Prefers an explicit
// order number, else the customer email. Returns a not-found context rather than
// throwing when nothing matches.
export async function getShopifyContext(
  cfg: IntegrationsConfig,
  params: { email?: string | null; orderNumber?: string | null },
): Promise<ShopifyContextDTO> {
  if (!hasShopify(cfg) || !cfg.shopify) {
    throw new Error("Shopify is not configured");
  }
  if (params.orderNumber?.trim()) {
    return byOrder(cfg.shopify, params.orderNumber);
  }
  if (params.email?.trim()) {
    return byEmail(cfg.shopify, params.email.trim());
  }
  return notFound();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Resolve the order/customer context for a whole thread: a pinned order →
// customer email → an order number found in the subject/body. Optionally pins a
// freshly-resolved order to the thread so it survives reloads. Shared by the API
// route and the Phase 3 drafting agent so the logic lives in one place.
export async function resolveThreadShopify(
  db: Db,
  cfg: IntegrationsConfig,
  threadId: string,
  opts: { persist?: boolean } = {},
): Promise<ShopifyContextDTO> {
  if (!hasShopify(cfg) || !cfg.shopify) {
    return { found: false, customer: null, orders: [], matchedBy: null };
  }
  const rows = await db
    .select({
      id: threads.id,
      email: threads.customerEmail,
      subject: threads.subject,
      pinned: threads.shopifyOrderName,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  const t = rows[0];
  if (!t) return { found: false, customer: null, orders: [], matchedBy: null };

  // 1) Pinned order is authoritative.
  if (t.pinned) {
    const ctx = await getShopifyContext(cfg, { orderNumber: t.pinned });
    if (ctx.found) return { ...ctx, matchedBy: "pinned" };
  }
  // 2) Customer email — unless the From is a platform/system sender (e.g.
  //    mailer@shopify.com for website contact-form submissions), which won't
  //    match a Shopify customer.
  if (t.email && !isSystemEmail(t.email)) {
    const ctx = await getShopifyContext(cfg, { email: t.email });
    if (ctx.found && ctx.orders.length > 0) return { ...ctx, matchedBy: "email" };
  }

  // Gather the subject + message bodies once for the body-based fallbacks.
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
      m.bodyText?.trim() ? m.bodyText : m.bodyHtml ? stripTags(m.bodyHtml) : "",
    ),
  ];
  const fullText = haystacks.join("\n");

  const persistOrder = async (name: string) => {
    if (opts.persist) {
      await db
        .update(threads)
        .set({ shopifyOrderName: name, updatedAt: new Date() })
        .where(eq(threads.id, t.id));
    }
  };

  // 3) Order number found in the subject/body.
  let orderNo: string | null = null;
  for (const h of haystacks) {
    orderNo = extractOrderNumber(h);
    if (orderNo) break;
  }
  if (orderNo) {
    const ctx = await getShopifyContext(cfg, { orderNumber: orderNo });
    if (ctx.found) {
      await persistOrder(ctx.orders[0]?.name ?? orderNo);
      return { ...ctx, matchedBy: "order" };
    }
  }

  // 4) A real customer email embedded in the body — covers website contact-form
  //    submissions delivered from mailer@shopify.com whose body holds the actual
  //    customer's address. Also try the From if it was a system sender skipped above.
  const bodyEmail = extractCustomerEmail(fullText);
  if (bodyEmail) {
    const ctx = await getShopifyContext(cfg, { email: bodyEmail });
    if (ctx.found) {
      if (ctx.orders[0]?.name) await persistOrder(ctx.orders[0].name);
      return { ...ctx, matchedBy: "email" };
    }
  }

  return { found: false, customer: null, orders: [], matchedBy: null };
}

// Format a resolved context as compact text for the drafting prompt.
export function formatShopifyContext(ctx: ShopifyContextDTO): string {
  if (!ctx.found) return "No matching Shopify order or customer was found.";
  const lines: string[] = [];
  if (ctx.customer) {
    lines.push(
      `Customer: ${ctx.customer.name ?? "(unknown)"}${
        ctx.customer.ordersCount != null ? ` — ${ctx.customer.ordersCount} order(s)` : ""
      }${ctx.customer.totalSpent ? `, ${ctx.customer.totalSpent} ${ctx.customer.currency ?? ""} lifetime` : ""}`,
    );
  }
  for (const o of ctx.orders) {
    const items = o.lineItems.map((li) => `${li.quantity}× ${li.title}`).join(", ");
    const tracking = o.tracking
      .map((t) => `${t.company ?? "tracking"} ${t.number ?? ""}${t.url ? ` (${t.url})` : ""}`.trim())
      .join("; ");
    lines.push(
      `Order ${o.name} — ${o.financialStatus ?? "?"}/${o.fulfillmentStatus ?? "?"}, ${
        o.total ? `${o.total} ${o.currency ?? ""}` : "?"
      }${items ? `\n  Items: ${items}` : ""}${tracking ? `\n  Tracking: ${tracking}` : ""}`,
    );
  }
  return lines.join("\n");
}
