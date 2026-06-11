// Public /stats page: aggregate-only numbers about this deployment — how
// many accounts and chats exist, and how many tokens have streamed through.
// The charts are hand-rolled SVG: two area charts and a bar row don't need
// a chart library. Served to anyone; the API behind it exposes no user data.
import { useEffect, useState } from "react";
import { dismissBootScreen } from "../boot";
import { LogoMark } from "./LogoMark";

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

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function AreaChart({ values }: { values: number[] }) {
  const w = 640;
  const h = 120;
  const pad = 4;
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const stepX = (w - pad * 2) / (values.length - 1);
  const points = values.map(
    (value, i) =>
      [pad + i * stepX, h - pad - (value / max) * (h - pad * 2)] as const,
  );
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="stats-chart"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={`${line} L${w - pad} ${h} L${pad} ${h} Z`} className="stats-area" />
      <path d={line} className="stats-line" fill="none" />
    </svg>
  );
}

function ChartCard({
  title,
  values,
  firstLabel,
  lastLabel,
}: {
  title: string;
  values: number[];
  firstLabel: string;
  lastLabel: string;
}) {
  return (
    <section className="stats-card">
      <h2>{title}</h2>
      <AreaChart values={values} />
      <div className="stats-axis">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
    </section>
  );
}

export function StatsPage() {
  const [stats, setStats] = useState<Stats | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then(async (response) => {
        if (!response.ok) throw new Error(`stats failed: ${response.status}`);
        setStats((await response.json()) as Stats);
      })
      .catch(() => setFailed(true))
      .finally(dismissBootScreen);
  }, []);

  if (failed) {
    return (
      <div className="stats-page">
        <main>
          <p className="stats-error">Stats are unavailable right now.</p>
        </main>
      </div>
    );
  }
  if (!stats) return null; // boot overlay is still covering the screen

  const totalTokens = stats.totals.inputTokens + stats.totals.outputTokens;
  const firstDay = stats.daily[0]?.day ?? "";
  const lastDay = stats.daily.at(-1)?.day ?? "";
  const maxPeriodTokens = Math.max(
    1,
    ...stats.tokensByPeriod.map((p) => p.inputTokens + p.outputTokens),
  );

  return (
    <div className="stats-page">
      <main>
        <header className="stats-head">
          <a className="wordmark" href="/">
            <span className="wordmark-glyph">
              <LogoMark size={13} />
            </span>
            Open Chat
          </a>
          <h1>Usage statistics</h1>
          <p>
            Live, anonymous aggregates from this deployment — counts only,
            never accounts or content.
          </p>
        </header>

        <div className="stats-totals">
          <div className="stats-total">
            <strong>{compact.format(stats.totals.users)}</strong>
            <span>accounts</span>
          </div>
          <div className="stats-total">
            <strong>{compact.format(stats.totals.chats)}</strong>
            <span>chats</span>
          </div>
          <div className="stats-total">
            <strong>{compact.format(totalTokens)}</strong>
            <span>
              tokens · {compact.format(stats.totals.inputTokens)} in,{" "}
              {compact.format(stats.totals.outputTokens)} out
            </span>
          </div>
        </div>

        <ChartCard
          title="New accounts — last 30 days"
          values={stats.daily.map((d) => d.newUsers)}
          firstLabel={firstDay}
          lastLabel={lastDay}
        />
        <ChartCard
          title="New chats — last 30 days"
          values={stats.daily.map((d) => d.newChats)}
          firstLabel={firstDay}
          lastLabel={lastDay}
        />

        {stats.tokensByPeriod.length > 0 ? (
          <section className="stats-card">
            <h2>Tokens by month</h2>
            <div className="stats-bars">
              {stats.tokensByPeriod.map((p) => {
                const total = p.inputTokens + p.outputTokens;
                return (
                  <div key={p.period} className="stats-bar-col">
                    <span className="stats-bar-value">
                      {compact.format(total)}
                    </span>
                    <div
                      className="stats-bar"
                      style={{
                        height: `${Math.max(2, (total / maxPeriodTokens) * 100)}%`,
                      }}
                    />
                    <span className="stats-bar-label">{p.period}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <footer className="stats-foot">
          <a href="/">← Back to Open Chat</a>
          <a
            href="https://github.com/prisma/open-chat"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
