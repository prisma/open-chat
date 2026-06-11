// Public, anonymized statistics for the /stats page. Everything served here
// is an aggregate — counts and token sums, never names, emails, titles, or
// message content — so the endpoint needs no auth. Results are memoized for
// a minute so a public page can't become a database load test.
import { pool } from "../../prisma/db";
import { assertMethod, json } from "../http";

const CACHE_MS = 60_000;
const WINDOW_DAYS = 30;

type Stats = {
  totals: {
    users: number;
    chats: number;
    inputTokens: number;
    outputTokens: number;
  };
  daily: Array<{ day: string; newUsers: number; newChats: number }>;
  tokensByPeriod: Array<{
    period: string;
    inputTokens: number;
    outputTokens: number;
  }>;
};

let cached: { at: number; stats: Stats } | undefined;

async function dailyCounts(table: "user" | "chat") {
  const result = await pool.query(
    `select to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as day,
            count(*)::int as count
       from "${table}"
      where "createdAt" >= now() - interval '${WINDOW_DAYS} days'
      group by 1`,
  );
  return new Map<string, number>(
    result.rows.map((row) => [row.day, row.count]),
  );
}

async function computeStats(): Promise<Stats> {
  const [totals, userDays, chatDays, periods] = await Promise.all([
    pool.query(
      `select (select count(*)::int from "user") as users,
              (select count(*)::int from "chat") as chats,
              (select coalesce(sum("inputTokens"), 0)::bigint from "usage") as input_tokens,
              (select coalesce(sum("outputTokens"), 0)::bigint from "usage") as output_tokens`,
    ),
    dailyCounts("user"),
    dailyCounts("chat"),
    pool.query(
      `select period,
              sum("inputTokens")::bigint as input_tokens,
              sum("outputTokens")::bigint as output_tokens
         from "usage"
        group by 1
        order by 1`,
    ),
  ]);

  // Zero-fill the window so the charts show quiet days as zero instead of
  // skipping them.
  const daily: Stats["daily"] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    daily.push({
      day,
      newUsers: userDays.get(day) ?? 0,
      newChats: chatDays.get(day) ?? 0,
    });
  }

  const row = totals.rows[0];
  return {
    totals: {
      users: row.users,
      chats: row.chats,
      // Postgres returns bigint sums as strings.
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
    },
    daily,
    tokensByPeriod: periods.rows.map((r) => ({
      period: r.period,
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
    })),
  };
}

export async function getStats(request: Request) {
  assertMethod(request, ["GET"]);
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), stats: await computeStats() };
  }
  return json(cached.stats, 200, { "Cache-Control": "public, max-age=300" });
}
