import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type {
  CategoryVolumeDTO,
  ConfidenceLevel,
  InsightsDTO,
  Sentiment,
  StatusBreakdownDTO,
  ThreadStatus,
  TrendPointDTO,
} from "@ms/shared";
import { SENTIMENTS } from "@ms/shared";
import { requireAuth } from "../auth";

const RANGE_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Read-only analytics dashboard. All metrics are GROUP BY aggregates over
// existing data — no per-row fetching, no writes.
export function registerInsightsRoutes(app: FastifyInstance): void {
  const { db } = app.appCtx;

  app.get<{ Querystring: { range?: string } }>(
    "/insights",
    { preHandler: requireAuth },
    async (request, reply) => {
      const reqRange = request.query.range ?? "";
      const range = reqRange in RANGE_DAYS ? reqRange : "30d";
      const days = RANGE_DAYS[range] ?? null;
      // Use epoch for "all" so every query can share a single `since` bind.
      const since = days
        ? new Date(Date.now() - days * 86_400_000)
        : new Date(0);
      const sinceIso = since.toISOString();
      // Trend is always bounded (≤90 points) regardless of range.
      const trendDays = Math.min(days ?? 30, 90);
      const trendSince = new Date(Date.now() - (trendDays - 1) * 86_400_000);
      const trendSinceIso = new Date(dayKey(trendSince)).toISOString();

      const totalsRows = (await db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE is_customer IS TRUE OR is_customer IS NULL)::int AS customer,
          count(*) FILTER (WHERE is_customer IS FALSE)::int AS noise,
          count(*) FILTER (WHERE is_customer IS NULL)::int AS untriaged
        FROM threads
        WHERE created_at >= ${sinceIso}
      `)) as unknown as {
        total: number;
        customer: number;
        noise: number;
        untriaged: number;
      }[];
      const totals = totalsRows[0] ?? {
        total: 0,
        customer: 0,
        noise: 0,
        untriaged: 0,
      };

      const catRows = (await db.execute(sql`
        SELECT c.id AS cid, c.slug, c.name, c.color, count(*)::int AS count
        FROM threads t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.is_customer IS NOT FALSE AND t.created_at >= ${sinceIso}
        GROUP BY c.id, c.slug, c.name, c.color
        ORDER BY count DESC
      `)) as unknown as {
        cid: string | null;
        slug: string | null;
        name: string | null;
        color: string | null;
        count: number;
      }[];
      const byCategory: CategoryVolumeDTO[] = catRows.map((r) => ({
        category:
          r.cid && r.slug && r.name && r.color
            ? { id: r.cid, slug: r.slug, name: r.name, color: r.color }
            : null,
        count: r.count,
      }));

      const statusRows = (await db.execute(sql`
        SELECT status, count(*)::int AS count
        FROM threads
        WHERE created_at >= ${sinceIso}
        GROUP BY status
      `)) as unknown as { status: ThreadStatus; count: number }[];
      const byStatus: StatusBreakdownDTO[] = statusRows.map((r) => ({
        status: r.status,
        count: r.count,
      }));

      const sentRows = (await db.execute(sql`
        SELECT sentiment, count(*)::int AS count
        FROM threads
        WHERE sentiment IS NOT NULL AND created_at >= ${sinceIso}
        GROUP BY sentiment
      `)) as unknown as { sentiment: string; count: number }[];
      const sentimentBuckets = sentRows
        .filter((r) => SENTIMENTS.includes(r.sentiment as Sentiment))
        .map((r) => ({ sentiment: r.sentiment as Sentiment, count: r.count }));

      const draftRows = (await db.execute(sql`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE confidence='high')::int AS high,
          count(*) FILTER (WHERE confidence='medium')::int AS medium,
          count(*) FILTER (WHERE confidence='low')::int AS low
        FROM drafts WHERE created_at >= ${sinceIso}
      `)) as unknown as {
        total: number;
        high: number;
        medium: number;
        low: number;
      }[];
      const d0 = draftRows[0] ?? { total: 0, high: 0, medium: 0, low: 0 };
      const sentRows2 = (await db.execute(sql`
        SELECT count(*)::int AS sent FROM sends WHERE sent_at >= ${sinceIso}
      `)) as unknown as { sent: number }[];
      const sent = sentRows2[0]?.sent ?? 0;
      const confidenceMix: { level: ConfidenceLevel; count: number }[] = [
        { level: "high", count: d0.high },
        { level: "medium", count: d0.medium },
        { level: "low", count: d0.low },
      ];

      // Trend: received (threads) + sent (sends) per day, densified.
      // Bucket in UTC on the SQL side so the day keys line up with the JS UTC
      // keys built by dayKey() (the postgres session TZ is otherwise undefined).
      const recvRows = (await db.execute(sql`
        SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, count(*)::int AS n
        FROM threads WHERE created_at >= ${trendSinceIso} GROUP BY d
      `)) as unknown as { d: string; n: number }[];
      const sentDayRows = (await db.execute(sql`
        SELECT to_char(date_trunc('day', sent_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d, count(*)::int AS n
        FROM sends WHERE sent_at >= ${trendSinceIso} GROUP BY d
      `)) as unknown as { d: string; n: number }[];
      const recvByDay = new Map(recvRows.map((r) => [r.d, r.n]));
      const sentByDay = new Map(sentDayRows.map((r) => [r.d, r.n]));
      const trend: TrendPointDTO[] = [];
      for (let i = 0; i < trendDays; i++) {
        const key = dayKey(new Date(trendSince.getTime() + i * 86_400_000));
        trend.push({
          date: key,
          received: recvByDay.get(key) ?? 0,
          sent: sentByDay.get(key) ?? 0,
        });
      }

      const result: InsightsDTO = {
        range,
        totals,
        byCategory,
        byStatus,
        sentiment: { available: true, buckets: sentimentBuckets },
        activity: {
          draftsGenerated: d0.total,
          sent,
          // Clamp: sends and drafts are different cohorts over the window, so the
          // raw ratio can exceed 1 — cap it so the displayed % is meaningful.
          approvalRate: d0.total > 0 ? Math.min(1, sent / d0.total) : 0,
          confidenceMix,
        },
        trend,
      };
      return reply.send(result);
    },
  );
}
