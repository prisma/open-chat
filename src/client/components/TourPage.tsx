// Public /tour page: a scroll-through explanation of how Open Chat works —
// what each piece of the stack does and how a prompt becomes a durable,
// replayable stream of tokens. Pure CSS/SVG animation: sections fade in
// via one IntersectionObserver, and the flow diagram animates with SMIL
// motion paths, so the page adds no dependencies.
import { useEffect } from "react";
import { dismissBootScreen } from "../boot";
import { GitHubMark } from "./GitHubMark";
import { LogoMark } from "./LogoMark";
import tourApp from "../assets/tour-app.webp";
import tourConsole from "../assets/tour-console.webp";

const REPO = "https://github.com/prisma/open-chat";
const blob = (path: string) => `${REPO}/blob/main/${path}`;

function Reveal({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`tour-reveal ${className}`}>{children}</div>;
}

function SectionHead({
  kicker,
  title,
  lede,
}: {
  kicker: string;
  title: string;
  lede: React.ReactNode;
}) {
  return (
    <Reveal>
      <span className="tour-kicker">{kicker}</span>
      <h2>{title}</h2>
      <p className="tour-lede">{lede}</p>
    </Reveal>
  );
}

function DocLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="tour-doclink" href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}

/**
 * The full request flow, animated. Dots ride SMIL motion paths:
 * accent = the user's prompt, amber = model deltas, green = durable
 * appends and the SSE tail that feeds the browser.
 */
function FlowDiagram() {
  return (
    <svg
      className="tour-diagram"
      viewBox="0 0 920 560"
      role="img"
      aria-label="Diagram: prompt flows from the browser through the Bun server to the LLM; every response delta is appended to Prisma Streams before the browser receives it over SSE; chat metadata lives in Prisma Postgres."
    >
      {/* ---- boxes ---- */}
      <g className="td-box">
        <rect x="30" y="170" width="220" height="150" rx="14" />
        <text x="140" y="206" className="td-title" textAnchor="middle">
          Browser
        </text>
        <text x="140" y="230" className="td-sub" textAnchor="middle">
          React + TanStack DB
        </text>
        <text x="140" y="262" className="td-note" textAnchor="middle">
          live queries render
        </text>
        <text x="140" y="280" className="td-note" textAnchor="middle">
          the event log as messages
        </text>
      </g>

      <g className="td-box">
        <rect x="370" y="150" width="220" height="190" rx="14" />
        <text x="480" y="188" className="td-title" textAnchor="middle">
          Bun server
        </text>
        <text x="480" y="212" className="td-sub" textAnchor="middle">
          on Prisma Compute
        </text>
        <text x="480" y="246" className="td-note" textAnchor="middle">
          auth · ownership · budgets
        </text>
        <text x="480" y="264" className="td-note" textAnchor="middle">
          appends before it serves
        </text>
      </g>

      <g className="td-box">
        <rect x="700" y="60" width="190" height="110" rx="14" />
        <text x="795" y="98" className="td-title" textAnchor="middle">
          OpenRouter
        </text>
        <text x="795" y="122" className="td-sub" textAnchor="middle">
          any LLM, streamed
        </text>
      </g>

      <g className="td-box td-box-streams">
        <rect x="340" y="420" width="280" height="110" rx="14" />
        <text x="480" y="458" className="td-title" textAnchor="middle">
          Prisma Streams
        </text>
        <text x="480" y="482" className="td-sub" textAnchor="middle">
          append-only event log
        </text>
        <text x="480" y="506" className="td-note" textAnchor="middle">
          one stream per user · key per chat
        </text>
      </g>

      <g className="td-box">
        <rect x="700" y="420" width="190" height="110" rx="14" />
        <text x="795" y="458" className="td-title" textAnchor="middle">
          Prisma Postgres
        </text>
        <text x="795" y="482" className="td-sub" textAnchor="middle">
          via Prisma Next
        </text>
        <text x="795" y="506" className="td-note" textAnchor="middle">
          users · chats · credits
        </text>
      </g>

      {/* ---- edges ---- */}
      {/* 1: prompt browser -> server */}
      <path id="tf-prompt" className="td-edge" d="M250 215 H370" />
      {/* 2: server -> llm */}
      <path id="tf-ask" className="td-edge" d="M590 195 C650 185 650 135 700 122" />
      {/* 3: llm deltas -> server */}
      <path id="tf-deltas" className="td-edge td-edge-deltas" d="M700 145 C655 160 645 205 590 218" />
      {/* 4: server -> streams (durable append) */}
      <path id="tf-append" className="td-edge td-edge-durable" d="M480 340 V420" />
      {/* 5: streams -> browser, but always through the server's authed proxy:
          leg A climbs back into the Bun server, leg B exits to the browser. */}
      <path
        id="tf-tail-a"
        className="td-edge td-edge-durable"
        d="M404 420 C394 392 398 364 412 340"
      />
      <path
        id="tf-tail-b"
        className="td-edge td-edge-durable"
        d="M370 262 C330 270 290 270 250 262"
      />
      {/* 6: server <-> postgres */}
      <path id="tf-sql" className="td-edge" d="M590 320 C660 360 680 400 718 420" />

      {/* ---- edge labels ---- */}
      <text x="310" y="203" className="td-label" textAnchor="middle">
        1 · prompt
      </text>
      <text x="650" y="140" className="td-label" textAnchor="middle">
        2 · ask
      </text>
      <text x="660" y="215" className="td-label td-label-deltas" textAnchor="middle">
        3 · deltas
      </text>
      <text x="494" y="390" className="td-label td-label-durable" textAnchor="start">
        4 · append first
      </text>
      <text x="310" y="246" className="td-label td-label-durable" textAnchor="middle">
        5 · SSE tail
      </text>
      <text x="310" y="292" className="td-note" textAnchor="middle">
        proxied · session-checked
      </text>
      <text x="680" y="390" className="td-label" textAnchor="middle">
        6 · metadata
      </text>

      {/* ---- animated tokens ---- */}
      <circle r="5" className="td-tok td-tok-accent">
        <animateMotion dur="6s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.18;1" calcMode="linear">
          <mpath href="#tf-prompt" />
        </animateMotion>
      </circle>
      <circle r="5" className="td-tok td-tok-accent">
        <animateMotion dur="6s" begin="1.1s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.18;1" calcMode="linear">
          <mpath href="#tf-ask" />
        </animateMotion>
      </circle>
      {[0, 1, 2].map((i) => (
        <circle r="4" className="td-tok td-tok-delta" key={`d${i}`}>
          <animateMotion
            dur="6s"
            begin={`${2.2 + i * 0.5}s`}
            repeatCount="indefinite"
            keyPoints="0;1;1"
            keyTimes="0;0.15;1"
            calcMode="linear"
          >
            <mpath href="#tf-deltas" />
          </animateMotion>
        </circle>
      ))}
      {[0, 1, 2].map((i) => (
        <circle r="4" className="td-tok td-tok-durable" key={`a${i}`}>
          <animateMotion
            dur="6s"
            begin={`${3.1 + i * 0.5}s`}
            repeatCount="indefinite"
            keyPoints="0;1;1"
            keyTimes="0;0.12;1"
            calcMode="linear"
          >
            <mpath href="#tf-append" />
          </animateMotion>
        </circle>
      ))}
      {[0, 1, 2].map((i) => (
        <circle r="4" className="td-tok td-tok-durable" key={`sa${i}`}>
          <animateMotion
            dur="6s"
            begin={`${3.7 + i * 0.5}s`}
            repeatCount="indefinite"
            keyPoints="0;1;1"
            keyTimes="0;0.1;1"
            calcMode="linear"
          >
            <mpath href="#tf-tail-a" />
          </animateMotion>
        </circle>
      ))}
      {[0, 1, 2].map((i) => (
        <circle r="4" className="td-tok td-tok-durable" key={`sb${i}`}>
          <animateMotion
            dur="6s"
            begin={`${4.1 + i * 0.5}s`}
            repeatCount="indefinite"
            keyPoints="0;1;1"
            keyTimes="0;0.12;1"
            calcMode="linear"
          >
            <mpath href="#tf-tail-b" />
          </animateMotion>
        </circle>
      ))}
      <circle r="4" className="td-tok td-tok-accent">
        <animateMotion dur="6s" begin="0.6s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.15;1" calcMode="linear">
          <mpath href="#tf-sql" />
        </animateMotion>
      </circle>
    </svg>
  );
}

/**
 * How data is laid out inside Prisma Streams: one append-only stream per
 * user, with each chat as a routing key whose events interleave freely.
 * A key-filtered read picks out one chat and can resume from any offset.
 */
const LANE1_KEYS = "abab cbac bab c abab".replace(/ /g, "").split("");

function StreamLayoutDiagram() {
  const cellX = (i: number) => 50 + i * 52;
  const resumeAt = 8;
  return (
    <svg
      className="tour-diagram tour-streams-diagram"
      viewBox="0 0 920 350"
      role="img"
      aria-label="Diagram: two per-user streams. Inside one stream, events from three chats interleave as colored cells, identified by routing keys. A marker shows a key-filtered read resuming from offset 8, returning only that chat's events."
    >
      <text x="30" y="28" className="ts-name">
        u_3f9c…_messages
      </text>
      <text x="890" y="28" className="td-note" textAnchor="end">
        one append-only stream per user
      </text>
      <rect x="30" y="44" width="860" height="78" rx="12" className="ts-lane" />
      <line
        x1={cellX(resumeAt) - 4}
        y1="40"
        x2={cellX(resumeAt) - 4}
        y2="160"
        className="ts-resume"
      />
      {LANE1_KEYS.map((key, i) => (
        <rect
          key={i}
          x={cellX(i)}
          y="60"
          width="46"
          height="46"
          rx="8"
          className={`ts-cell ts-cell-${key}${
            key === "b" && i >= resumeAt ? " ts-cell-read" : ""
          }`}
        />
      ))}
      <text x="50" y="146" className="td-note">
        offset 0
      </text>
      <text x="890" y="146" className="td-note" textAnchor="end">
        appends → live
      </text>
      <text
        x={cellX(resumeAt) + 6}
        y="158"
        className="td-label td-label-durable"
      >
        read key=chat:cows from offset {resumeAt} → only ▮▮, then live
      </text>

      <text x="30" y="212" className="ts-name">
        u_77b2…_messages
      </text>
      <rect x="30" y="226" width="860" height="78" rx="12" className="ts-lane" />
      {["a", "c", "a", "a", "c", "a"].map((key, i) => (
        <rect
          key={i}
          x={cellX(i)}
          y="242"
          width="46"
          height="46"
          rx="8"
          className={`ts-cell ts-cell-${key} ts-dim`}
        />
      ))}
      <text x={cellX(6) + 10} y="274" className="ts-name">
        …
      </text>

      <rect x="30" y="326" width="12" height="12" rx="3" className="ts-cell ts-cell-a" />
      <text x="48" y="337" className="td-note">
        chat:cats
      </text>
      <rect x="124" y="326" width="12" height="12" rx="3" className="ts-cell ts-cell-b" />
      <text x="142" y="337" className="td-note">
        chat:cows
      </text>
      <rect x="226" y="326" width="12" height="12" rx="3" className="ts-cell ts-cell-c" />
      <text x="244" y="337" className="td-note">
        chat:haiku
      </text>
      <text x="890" y="337" className="td-note" textAnchor="end">
        routing keys — chats interleave freely in one log
      </text>
    </svg>
  );
}

const FLOW_STEPS: Array<{ n: string; title: string; body: string }> = [
  {
    n: "1",
    title: "You send a prompt",
    body: "The browser POSTs it to the Bun server, which checks your session, chat ownership, and credit balance.",
  },
  {
    n: "2",
    title: "The server asks the model",
    body: "One streaming call to OpenRouter — any model in their catalog: text, vision, or image generation, switchable mid-chat.",
  },
  {
    n: "3",
    title: "Tokens stream back",
    body: "The model replies as a stream of small deltas, a few words at a time.",
  },
  {
    n: "4",
    title: "Every delta is appended first",
    body: "Before the browser ever sees a token, it is written to the user's durable stream. The log is the chat — not a cache of it.",
  },
  {
    n: "5",
    title: "The browser tails the log",
    body: "An SSE connection replays from any offset, then follows live. It never touches Streams directly — the Bun server on Prisma Compute proxies the tail and checks your session first. Refresh mid-answer and the reply resumes exactly where it was.",
  },
  {
    n: "6",
    title: "Metadata stays relational",
    body: "Chat titles, accounts, and credits live in Prisma Postgres, queried through Prisma Next's typed client. In the browser, TanStack DB joins both worlds — relational data and the live event stream — into one set of live queries.",
  },
];

export function TourPage() {
  useEffect(() => {
    dismissBootScreen();
    document.title = "How Open Chat works";

    const revealed = document.querySelectorAll(".tour-reveal");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const el of revealed) el.classList.add("in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -40px 0px" },
    );
    for (const el of revealed) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="tour-page">
      {/* ---------- Hero ---------- */}
      <header className="tour-hero">
        <a className="wordmark" href="/">
          <span className="wordmark-glyph">
            <LogoMark size={13} />
          </span>
          Open Chat
        </a>
        <h1>
          Chat that <em>never drops a token.</em>
        </h1>
        <p>
          Open Chat is an open-source AI chat app — and a working lesson in
          building one on <strong>Prisma Streams</strong>,{" "}
          <strong>Prisma Postgres</strong>, <strong>Prisma Next</strong>,{" "}
          <strong>Prisma Compute</strong>, and <strong>TanStack DB</strong>.
          Scroll to see how a prompt becomes a durable, replayable stream.
        </p>
        <div className="tour-cta">
          <a className="button primary" href="/">
            Try it live
          </a>
          <a
            className="button"
            href={REPO}
            target="_blank"
            rel="noreferrer"
          >
            <GitHubMark size={15} /> Read the code
          </a>
        </div>
        <div className="tour-scroll-hint" aria-hidden>
          ↓
        </div>
      </header>

      <main>
        {/* ---------- The idea ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="The idea"
            title="The chat history is a log, not a table"
            lede={
              <>
                Most chat apps stream tokens to the browser and save the
                message afterwards — kill the tab mid-answer and the tail is
                gone. Open Chat inverts that: every event is appended to a
                durable log <em>first</em>, and everything you see is a replay
                of it. A dropped connection, a refresh, even a server restart
                changes nothing — reconnect, replay from your last offset,
                catch up.
              </>
            }
          />
          <Reveal className="tour-event-demo">
            <pre className="tour-code">
              <span className="c">{"// what actually gets stored — an append-only sequence of events"}</span>
              {"\n"}
              {'{ "type": "message.created",   "role": "user",      "text": "Tell me about cows!" }\n'}
              {'{ "type": "message.created",   "role": "assistant", "text": "" }\n'}
              {'{ "type": "message.delta",     "role": "assistant", "text": "Cows are" }\n'}
              {'{ "type": "message.delta",     "role": "assistant", "text": " fascinating" }\n'}
              <span className="dim">{"…one event per token batch…"}</span>
              {"\n"}
              {'{ "type": "message.completed", "usage": { "outputTokens": 312, "costMicroUsd": 9 } }'}
            </pre>
            <p className="tour-caption">
              One pure function folds this log into messages — the same
              function on the server (history replay) and in the browser (live
              feed), so the two can never disagree.{" "}
              <DocLink href={blob("src/shared/messages.ts")}>
                src/shared/messages.ts
              </DocLink>
            </p>
          </Reveal>
        </section>

        {/* ---------- The flow ---------- */}
        <section className="tour-section tour-section-wide">
          <SectionHead
            kicker="The whole system"
            title="One prompt, end to end"
            lede={
              <>
                Six moving parts, one rule: nothing reaches your screen that
                isn't already durable. Watch the tokens flow — amber deltas
                arrive from the model, turn green the moment they're appended
                to the log, and only then travel to the browser.
              </>
            }
          />
          <Reveal>
            <FlowDiagram />
          </Reveal>
          <div className="tour-steps">
            {FLOW_STEPS.map((step) => (
              <Reveal className="tour-step" key={step.n}>
                <span className="tour-step-n">{step.n}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="tour-caption">
              The full design, including why streaming survives restarts:{" "}
              <DocLink href={blob("docs/architecture.md")}>
                docs/architecture.md
              </DocLink>
            </p>
          </Reveal>
        </section>

        {/* ---------- Prisma Streams ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="Prisma Streams"
            title="One stream per user, one key per chat"
            lede={
              <>
                Each user owns a single append-only stream; each chat is a
                routing key inside it. Appends return an offset, reads resume
                from any offset, and long-poll reads make the SSE tail cheap.
                The browser never talks to Streams directly — the Bun server
                checks the session and proxies.
              </>
            }
          />
          <Reveal>
            <StreamLayoutDiagram />
            <p className="tour-caption">
              Key-filtered reads stay fast as the log grows — Streams keeps a
              tiered routing-key index on the side, without ever touching the
              single-log write path:{" "}
              <DocLink href="https://github.com/prisma/streams/blob/main/docs/tiered-index.md">
                docs/tiered-index.md
              </DocLink>
            </p>
          </Reveal>
          <Reveal>
            <pre className="tour-code">
              <span className="c">{"// append: durable before the UI sees it"}</span>
              {"\n"}
              <span className="tk-kw">POST</span>
              {" /v1/stream/u_3f9c…_messages\n"}
              <span className="tk-attr">stream-key</span>
              {": chat:chat_38eb…\n\n"}
              <span className="c">{"// read: replay + live tail from any offset"}</span>
              {"\n"}
              <span className="tk-kw">GET</span>
              {"  /v1/stream/u_3f9c…_messages?"}
              <span className="tk-attr">offset</span>
              {"=412&"}
              <span className="tk-attr">live</span>
              {"=true&"}
              <span className="tk-attr">key</span>
              {"=chat:chat_38eb…"}
            </pre>
            <p className="tour-caption">
              The whole client is ~140 lines:{" "}
              <DocLink href={blob("src/server/streams.ts")}>
                src/server/streams.ts
              </DocLink>{" "}
              · the deployable Streams service itself is mostly configuration:{" "}
              <DocLink href={blob("src/streams-app/index.ts")}>
                src/streams-app/index.ts
              </DocLink>
            </p>
          </Reveal>
        </section>

        {/* ---------- Prisma Next + Postgres ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="Prisma Next + Prisma Postgres"
            title="Everything relational stays typed"
            lede={
              <>
                Users, sessions, chats, credits — the queryable, transactional
                side of the app lives in Prisma Postgres. Prisma Next turns one
                contract file into a fully typed client: every table, column,
                and relation autocompletes, and the schema is applied with one
                command.
              </>
            }
          />
          <Reveal>
            <pre className="tour-code">
              <span className="c">{"// src/prisma/contract.prisma"}</span>
              {"\n"}
              <span className="tk-kw">model</span>{" "}
              <span className="tk-type">Chat</span>
              {" {\n  id        "}
              <span className="tk-type">String</span>
              {"   "}
              <span className="tk-attr">@id</span>
              {"\n  userId    "}
              <span className="tk-type">String</span>
              {"\n  title     "}
              <span className="tk-type">String</span>
              {"\n  model     "}
              <span className="tk-type">String</span>
              {"\n  updatedAt "}
              <span className="tk-fn">temporal.updatedAt()</span>
              {"\n}\n\n"}
              <span className="c">{"// anywhere on the server — fully typed"}</span>
              {"\n"}
              <span className="tk-kw">const</span>
              {" chats = "}
              <span className="tk-kw">await</span>
              {" db.orm."}
              <span className="tk-type">Chat</span>
              {"."}
              <span className="tk-fn">where</span>
              {"({ userId })\n  ."}
              <span className="tk-fn">orderBy</span>
              {"((chat) "}
              <span className="tk-kw">{"=>"}</span>
              {" chat.updatedAt."}
              <span className="tk-fn">desc</span>
              {"())\n  ."}
              <span className="tk-fn">all</span>
              {"();"}
            </pre>
            <p className="tour-caption">
              The contract:{" "}
              <DocLink href={blob("src/prisma/contract.prisma")}>
                src/prisma/contract.prisma
              </DocLink>{" "}
              · how the workflow operates:{" "}
              <DocLink href={blob("prisma-next.md")}>prisma-next.md</DocLink>
            </p>
          </Reveal>
        </section>

        {/* ---------- TanStack DB ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="TanStack DB"
            title="The UI is a live query over the log"
            lede={
              <>
                There is no bespoke state manager. Server data sits in query
                collections, stream events fold into a local messages
                collection, and components render live queries. When an event
                arrives, exactly the affected rows update — streaming hundreds
                of deltas re-renders one message, not the page.
              </>
            }
          />
          <Reveal>
            <pre className="tour-code">
              <span className="c">{"// events fold into a collection…"}</span>
              {"\n"}
              <span className="tk-fn">applyMessageEvent</span>
              {"(messages, event);\n\n"}
              <span className="c">{"// …and components just query it"}</span>
              {"\n"}
              <span className="tk-kw">const</span>
              {" { data: messages } = "}
              <span className="tk-fn">useLiveQuery</span>
              {"(messagesCollection);"}
            </pre>
            <p className="tour-caption">
              All client state in one file:{" "}
              <DocLink href={blob("src/client/db.ts")}>
                src/client/db.ts
              </DocLink>{" "}
              · the SSE consumer:{" "}
              <DocLink href={blob("src/client/stream.ts")}>
                src/client/stream.ts
              </DocLink>
            </p>
          </Reveal>
        </section>

        {/* ---------- Prisma Compute ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="Prisma Compute"
            title="Two apps, one deploy command each"
            lede={
              <>
                Production is this repo, twice: the chat server and the Streams
                service, deployed side by side in the same project as the
                database. The CLI builds locally, uploads, and the deployment
                is live in seconds — secrets live in Compute's env config,
                never in the repo.
              </>
            }
          />
          <Reveal>
            <pre className="tour-code">
              {"$ bunx @prisma/cli app deploy --app Streams \\\n"}
              {"    --entry src/streams-app/index.ts --prod\n"}
              {"$ bunx @prisma/cli app deploy --app open-chat \\\n"}
              {"    --entry src/start.ts --prod\n\n"}
              <span className="dim">{"Live in 13.7s  →  https://oss.chat"}</span>
            </pre>
            <p className="tour-caption">
              Step-by-step instructions:{" "}
              <DocLink href={`${REPO}#deploy-to-prisma-compute`}>
                README · Deploy to Prisma Compute
              </DocLink>
            </p>
          </Reveal>
          <Reveal>
            <figure className="tour-shot">
              <img
                src={tourConsole}
                alt="Prisma Console showing the open-chat project: the Streams and open-chat apps plus the primary database, live on the main branch"
                loading="lazy"
              />
              <figcaption>
                The whole production setup in{" "}
                <a
                  href="https://console.prisma.io"
                  target="_blank"
                  rel="noreferrer"
                >
                  console.prisma.io
                </a>
                : two apps and the primary database, live on the{" "}
                <span className="mono">main</span> branch.
              </figcaption>
            </figure>
          </Reveal>
        </section>

        {/* ---------- More to explore ---------- */}
        <section className="tour-section">
          <SectionHead
            kicker="Keep digging"
            title="The same patterns, reused"
            lede="Once the log is the source of truth, other features get simpler. A few places to keep reading:"
          />
          <div className="tour-cards">
            <Reveal className="tour-card">
              <h3>Billing you can audit</h3>
              <p>
                Credits are a ledger in Postgres; every Stripe webhook is
                appended to its own stream — verified, rejected, or replayed,
                the evidence survives.
              </p>
              <DocLink href={blob("src/server/billing.ts")}>
                src/server/billing.ts
              </DocLink>
            </Reveal>
            <Reveal className="tour-card">
              <h3>Images in the log</h3>
              <p>
                Generated images ride the same event stream: thumbnails inline
                in the log, originals in object storage, served per-user.
              </p>
              <DocLink href={blob("src/server/routes/content.ts")}>
                src/server/routes/content.ts
              </DocLink>
            </Reveal>
            <Reveal className="tour-card">
              <h3>Live public stats</h3>
              <p>
                Anonymous aggregates straight from Postgres — accounts, chats,
                and tokens streamed, on one public page.
              </p>
              <DocLink href="/stats">oss.chat/stats</DocLink>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="tour-foot">
        <Reveal>
          <figure className="tour-shot tour-shot-app">
            <img
              src={tourApp}
              alt="Open Chat running at oss.chat: an image-generation chat where a painted purple cat is revised to yellow"
              loading="lazy"
            />
          </figure>
        </Reveal>
        <Reveal>
          <h2>Now read it running.</h2>
          <p className="tour-foot-lede">
            Everything on this page is live at oss.chat — and everything
            behind it deploys with one CLI command.
          </p>
          <div className="tour-cta">
            <a className="button primary" href="/">
              Try Open Chat
            </a>
            <a
              className="button"
              href="https://console.prisma.io"
              target="_blank"
              rel="noreferrer"
            >
              Try Prisma Compute
            </a>
            <a className="button" href={REPO} target="_blank" rel="noreferrer">
              <GitHubMark size={15} /> prisma/open-chat
            </a>
          </div>
          <p className="tour-foot-note">
            MIT licensed · ~6,000 lines · built to be read
          </p>
        </Reveal>
      </footer>
    </div>
  );
}
