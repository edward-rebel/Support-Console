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

// Look up a customer by email + their most recent orders.
async function byEmail(s: ShopifyConfig, email: string): Promise<ShopifyContextDTO> {
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
    { q: `email:${email}` },
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

// Public entry point used by the API + (Phase 3) the drafting agent. Prefers an
// explicit order number, else the customer email. Returns a not-found context
// rather than throwing when nothing matches.
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
