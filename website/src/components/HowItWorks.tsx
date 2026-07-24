import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/*
 * HowItWorks — "Do the work in chat. Then automate it."
 * Ported 1:1 from the dark landing DC (hiw* scroll logic + markup).
 *
 * Desktop + motion allowed: a 500vh section with a position:sticky, 100vh inner
 * stage. Scroll progress across the section maps to 6 stages (0..5) of ONE chat
 * thread. Reduced motion OR viewport <=860px: NO sticky scroll — two stacked
 * static panels ("Work in chat" / "Automate"), each showing its slice of the
 * thread statically so the story reads with no animation and with JS disabled.
 *
 * Invariant: server render and first client render are BOTH the static layout
 * (no window at SSR), so hydration matches; an effect then upgrades desktop-
 * with-motion to the scroll layout. Keeps the section correct with JS off.
 */

const GEIST = "'Geist',var(--font-sans)";
const AGENTA_SYMBOL = "/logos/Agenta-symbol-dark-accent.svg";

// Stage at which each of the 7 message blocks first appears (dc: revealAt).
const REVEAL_AT = [0, 1, 2, 3, 4, 5, 5];

// Base wrapper style for each message block (the part before the reveal toggle).
const BLOCK_BASE: CSSProperties[] = [
  { flexDirection: "column", alignItems: "flex-end", gap: 6 },
  {
    flexDirection: "column",
    gap: 9,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 12,
  },
  { flexDirection: "column", gap: 8 },
  { flexDirection: "column", alignItems: "flex-end", gap: 6 },
  {
    flexDirection: "column",
    gap: 9,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 12,
  },
  { alignItems: "center", gap: 12, padding: "2px 0" },
  { flexDirection: "column", gap: 9 },
];

const SHOWN: CSSProperties = {
  display: "flex",
  opacity: 1,
  transform: "translateY(0)",
};
const HIDDEN: CSSProperties = { display: "none" };

function GreenCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="7" fill="#3FA554" />
      <path
        d="M4.2 7.2 6.2 9l3.6-4"
        stroke="#fff"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolRow({ label, meta }: { label: string; meta: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 13px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
      }}
    >
      <GreenCheck />
      <span
        style={{
          font: "var(--app-text-mono)",
          fontSize: 12,
          color: "rgba(255,255,255,0.78)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          marginLeft: "auto",
          font: `400 12px/1 ${GEIST}`,
          color: "rgba(255,255,255,0.38)",
        }}
      >
        {meta}
      </span>
    </div>
  );
}

function AgentLabel() {
  return (
    <span
      style={{
        font: `600 10.5px/1 ${GEIST}`,
        letterSpacing: "0.08em",
        color: "rgba(255,255,255,0.35)",
      }}
    >
      AGENT
    </span>
  );
}

// The 7 message-block bodies. Each takes its fully-merged wrapper style.
function renderBlock(i: number, wrap: CSSProperties): ReactNode {
  switch (i) {
    case 0:
      return (
        <div key="b0" style={wrap}>
          <span
            style={{
              font: `400 11px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.35)",
            }}
          >
            2m ago{" "}
            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>
              YOU
            </span>
          </span>
          <div
            style={{
              maxWidth: "78%",
              padding: "11px 15px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
              font: `400 13.5px/1.55 ${GEIST}`,
              color: "#F0EFF2",
            }}
          >
            Check how the new onboarding flow is performing in PostHog and
            update the onboarding PRD in the workspace with the results.
          </div>
        </div>
      );
    case 1:
      return (
        <div key="b1" style={wrap}>
          <AgentLabel />
          <span
            style={{
              font: `italic 400 12.5px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            {"▸"}
            {" "}Thought for 2s
          </span>
          <ToolRow label="posthog.QUERY_FUNNEL" meta="3 results · 1.2s" />
          <ToolRow
            label="workspace.WRITE_FILE"
            meta="onboarding-v2-prd.md · 0.6s"
          />
        </div>
      );
    case 2:
      return (
        <div key="b2" style={wrap}>
          <div
            style={{
              font: `400 13.5px/1.6 ${GEIST}`,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            Onboarding completion is{" "}
            <span style={{ color: "#FFFFFF", fontWeight: 500 }}>64%</span>, down
            4% week over week. Biggest drop-off is step 3, connect data source.
            I updated{" "}
            <span
              style={{
                font: "var(--app-text-mono)",
                fontSize: 12,
                color: "#F0EFF2",
                background: "rgba(255,255,255,0.06)",
                padding: "2px 7px",
                borderRadius: 5,
              }}
            >
              onboarding-v2-prd.md
            </span>{" "}
            with the numbers and a short read.
          </div>
          <span
            style={{
              font: `400 11.5px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.32)",
            }}
          >
            2m ago{" "}·{" "}5.3s{" "}·{" "}28.3K tokens
            {" "}·{" "}$0.00
          </span>
        </div>
      );
    case 3:
      return (
        <div key="b3" style={wrap}>
          <span
            style={{
              font: `400 11px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.35)",
            }}
          >
            now{" "}
            <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>
              YOU
            </span>
          </span>
          <div
            style={{
              maxWidth: "78%",
              padding: "11px 15px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
              font: `400 13.5px/1.55 ${GEIST}`,
              color: "#F0EFF2",
            }}
          >
            Do this every Monday at 9:00. Flag anything that drops more than
            10%.
          </div>
        </div>
      );
    case 4:
      return (
        <div key="b4" style={wrap}>
          <AgentLabel />
          <div
            style={{
              alignSelf: "flex-start",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "15px 17px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.025)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.09)",
              minWidth: "min(340px,100%)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <img
                src={AGENTA_SYMBOL}
                alt=""
                style={{ width: 17 }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <span style={{ font: `500 13.5px/1 ${GEIST}`, color: "#FFFFFF" }}>
                Agent scheduled
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 24,
                  padding: "0 12px",
                  borderRadius: 999,
                  background: "var(--grad-btn-primary)",
                  boxShadow: "var(--shadow-btn-primary)",
                  font: `600 12px/1 ${GEIST}`,
                  color: "var(--ink-900)",
                }}
              >
                On schedule
              </span>
              <span
                style={{
                  font: "var(--app-text-mono)",
                  fontSize: 12,
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                Mondays · 09:00 · flag drops &gt; 10%
              </span>
            </div>
          </div>
        </div>
      );
    case 5:
      return (
        <div key="b5" style={wrap}>
          <span
            style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }}
          />
          <span
            style={{
              font: "var(--app-text-mono)",
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
            }}
          >
            Monday 09:00 — ran while you were out
          </span>
          <span
            style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }}
          />
        </div>
      );
    case 6:
      return (
        <div key="b6" style={wrap}>
          <AgentLabel />
          <ToolRow
            label="workspace.WRITE_FILE"
            meta="onboarding-v2-prd.md · 09:02"
          />
          <div
            style={{
              font: `400 13.5px/1.6 ${GEIST}`,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 9px",
                borderRadius: 6,
                background: "rgba(217,119,87,0.14)",
                boxShadow: "inset 0 0 0 1px rgba(217,119,87,0.3)",
                font: `500 11.5px/1 ${GEIST}`,
                color: "#F7F6F4",
                marginRight: 8,
              }}
            >
              Flagged
            </span>
            Step 3 drop-off increased 12% this week. PRD updated. Worth a look
            before standup.
          </div>
          <span
            style={{
              font: `400 11.5px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.32)",
            }}
          >
            Mon 09:02{" "}·{" "}41s{" "}·{" "}12.1K tokens
            {" "}·{" "}$0.00
          </span>
        </div>
      );
    default:
      return null;
  }
}

type FileRow = { name: string; meta: string; hot: boolean; hidden: boolean };

function filesForStage(stage: number): FileRow[] {
  const fresh = stage === 2 || stage === 5;
  return [
    {
      name: "onboarding-v2-prd.md",
      meta:
        stage >= 5
          ? "edited Mon 09:02"
          : stage >= 2
            ? "edited just now"
            : "last week",
      hot: fresh,
      hidden: false,
    },
    {
      name: "funnel-week-29.csv",
      meta: stage >= 5 ? "new · Mon 09:01" : "new",
      hot: false,
      hidden: stage < 2,
    },
    { name: "wiki.md", meta: "2 days ago", hot: false, hidden: false },
    {
      name: "customer-interviews.md",
      meta: "last week",
      hot: false,
      hidden: false,
    },
  ];
}

function FilesDrawer({ stage }: { stage: number }) {
  const files = filesForStage(stage);
  const count = stage >= 2 ? "4" : "3";
  return (
    <div className="ag-hiw-files" style={{ flex: "0 0 auto", width: 212 }}>
      <div
        style={{
          width: 212,
          height: "100%",
          borderLeft: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "13px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          </svg>
          <span
            style={{
              font: `500 11.5px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            Files
          </span>
          <span
            style={{
              marginLeft: "auto",
              font: `400 11px/1 ${GEIST}`,
              color: "rgba(255,255,255,0.3)",
            }}
          >
            {count}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            padding: 8,
            textAlign: "left",
          }}
        >
          {files.map((f) => (
            <div
              key={f.name}
              style={{
                alignItems: "flex-start",
                gap: 9,
                padding: "9px 10px",
                borderRadius: 7,
                transition:
                  "background 0.5s ease, box-shadow 0.5s ease, opacity 0.5s ease",
                display: f.hidden ? "none" : "flex",
                opacity: 1,
                ...(f.hot
                  ? {
                      background: "rgba(242,242,92,0.06)",
                      boxShadow: "inset 0 0 0 1px rgba(242,242,92,0.2)",
                    }
                  : {}),
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={f.hot ? "var(--yellow-400)" : "rgba(255,255,255,0.4)"}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flex: "0 0 auto" }}
                aria-hidden="true"
              >
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
              </svg>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    font: "var(--app-text-mono)",
                    fontSize: 11,
                    color: f.hot ? "#FFFFFF" : "rgba(255,255,255,0.62)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.name}
                </span>
                <span
                  style={{
                    font: `400 10.5px/1 ${GEIST}`,
                    color: f.hot
                      ? "rgba(242,242,92,0.85)"
                      : "rgba(255,255,255,0.3)",
                  }}
                >
                  {f.meta}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Composer() {
  return (
    <div
      style={{
        flex: "0 0 auto",
        margin: "0 16px 16px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.09)",
        padding: "13px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <span
        style={{
          font: `400 13.5px/1 ${GEIST}`,
          color: "rgba(255,255,255,0.35)",
        }}
      >
        Ask the agent...
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        <span
          style={{
            marginLeft: "auto",
            font: `400 11.5px/1 ${GEIST}`,
            color: "rgba(255,255,255,0.3)",
          }}
        >
          {"⏎"} send · {"⇧"}
          {"⏎"} newline
        </span>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.1)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 10V2M2.5 5.5 6 2l3.5 3.5"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

/*
 * The dark product chat card. `stage` drives the files drawer; `blocks` are the
 * pre-rendered, already-styled message nodes to place in the thread column.
 */
function ChatCard({
  stage,
  blocks,
  height,
  justify,
}: {
  stage: number;
  blocks: ReactNode;
  height: string;
  justify: CSSProperties["justifyContent"];
}) {
  return (
    <div
      style={{
        height,
        minWidth: 0,
        borderRadius: 12,
        background: "#161519",
        boxShadow:
          "0 24px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: GEIST,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: justify,
            gap: 14,
            padding: "20px 24px",
            textAlign: "left",
          }}
        >
          {blocks}
        </div>
        <FilesDrawer stage={stage} />
      </div>
      <Composer />
    </div>
  );
}

function Header() {
  return (
    <header
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "center",
        textAlign: "center",
        maxWidth: 560,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 12px",
          borderRadius: "var(--radius-pill)",
          font: "var(--text-caption)",
          letterSpacing: "var(--tracking-caption)",
          whiteSpace: "nowrap",
          boxSizing: "border-box",
          background: "rgba(255,255,255,0.06)",
          color: "rgba(255,255,255,0.8)",
          boxShadow: "0 0 0 1px rgba(229,229,227,0.18)",
        }}
      >
        How it works
      </span>
      <h2
        style={{
          margin: 0,
          font: "var(--text-display-lg)",
          color: "#FFFFFF",
          textWrap: "pretty",
        }}
      >
        Do the work in chat. Then automate it.
      </h2>
      <p
        style={{
          margin: 0,
          font: "var(--text-body-md)",
          color: "var(--text-on-dark-muted)",
          textWrap: "pretty",
        }}
      >
        Your agent works with your apps and files. One more message puts it on a
        schedule.
      </p>
    </header>
  );
}

const BEATS = [
  {
    title: "Work in chat",
    body: "Build custom agents that share your context and integrations.",
    target: 0,
  },
  {
    title: "Automate",
    body: "Tell it when to run. The same agent keeps doing the job without you.",
    target: 3,
  },
];

function Chevron({ active }: { active: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        flex: "0 0 auto",
        transform: active ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.3s ease",
      }}
      aria-hidden="true"
    >
      <path
        d="M3 6l5 5 5-5"
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HowItWorks() {
  // Both SSR and first client render start static so hydration matches; an
  // effect upgrades desktop-with-motion to the scroll layout.
  const [scroll, setScroll] = useState(false);
  const [stage, setStage] = useState(0);
  const [shortViewport, setShortViewport] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Decide layout from motion preference + viewport width.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = window.matchMedia("(max-width: 860px)");
    const decide = () => setScroll(!(reduce.matches || narrow.matches));
    decide();
    reduce.addEventListener("change", decide);
    narrow.addEventListener("change", decide);
    return () => {
      reduce.removeEventListener("change", decide);
      narrow.removeEventListener("change", decide);
    };
  }, []);

  // Scroll → stage, only while the sticky-scroll layout is active.
  useEffect(() => {
    if (!scroll) return;
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      const next = Math.min(5, Math.floor(p * 6));
      setStage((prev) => (prev !== next ? next : prev));
    };
    const onResize = () => setShortViewport(window.innerHeight < 700);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();
    onResize();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [scroll]);

  const goTo = (target: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top =
      el.offsetTop +
      (el.offsetHeight - window.innerHeight) * ((target + 0.5) / 6);
    window.scrollTo({ top, behavior: "smooth" });
  };

  // ---- static (reduced motion / mobile / no-JS) layout ----
  if (!scroll) {
    const panel = (label: string, body: string, stg: number, idx: number[]) => {
      const blocks = idx.map((i) =>
        renderBlock(i, { ...BLOCK_BASE[i], ...SHOWN }),
      );
      return (
        <div
          style={{
            width: "min(680px,100%)",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                font: "300 27px/1.2 var(--font-display,'GT Alpina',serif)",
                color: "#F7F6F4",
              }}
            >
              {label}
            </span>
            <span
              style={{
                font: "var(--text-body-sm)",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              {body}
            </span>
          </div>
          <ChatCard
            stage={stg}
            blocks={blocks}
            height="auto"
            justify="flex-start"
          />
        </div>
      );
    };
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
          padding: "0 24px",
          boxSizing: "border-box",
        }}
      >
        <Header />
        {panel(BEATS[0].title, BEATS[0].body, 2, [0, 1, 2])}
        {panel(BEATS[1].title, BEATS[1].body, 5, [3, 4, 5, 6])}
      </div>
    );
  }

  // ---- desktop scroll-driven layout ----
  const reveal = (i: number): CSSProperties =>
    stage >= REVEAL_AT[i]
      ? {
          ...BLOCK_BASE[i],
          ...SHOWN,
          transition: "opacity 0.45s ease, transform 0.45s ease",
        }
      : { ...BLOCK_BASE[i], ...HIDDEN };
  const blocks = REVEAL_AT.map((_, i) => renderBlock(i, reveal(i)));

  const beatActive = [stage <= 2, stage >= 3];

  return (
    <div ref={sectionRef} style={{ height: "500vh", boxSizing: "border-box" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "clamp(14px,3.5vh,40px)",
          overflow: "hidden",
        }}
      >
        {!shortViewport && <Header />}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px,340px) minmax(0,1fr)",
            gap: "clamp(20px,3.5vw,56px)",
            width: "min(1072px,calc(100% - 48px))",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            {BEATS.map((b, i) => {
              const active = beatActive[i];
              return (
                <div
                  key={b.title}
                  role="button"
                  tabIndex={0}
                  aria-expanded={active}
                  onClick={() => goTo(b.target)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goTo(b.target);
                    }
                  }}
                  style={{
                    padding: "24px 2px",
                    cursor: "pointer",
                    borderTop: "1px solid rgba(255,255,255,0.12)",
                    ...(i === BEATS.length - 1
                      ? { borderBottom: "1px solid rgba(255,255,255,0.12)" }
                      : {}),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <span
                      style={{
                        font: "300 27px/1.2 var(--font-display,'GT Alpina',serif)",
                        color: active ? "#F7F6F4" : "rgba(255,255,255,0.55)",
                      }}
                    >
                      {b.title}
                    </span>
                    <Chevron active={active} />
                  </div>
                  <div
                    style={{
                      overflow: "hidden",
                      transition:
                        "max-height 0.35s ease, opacity 0.35s ease, margin-top 0.35s ease",
                      ...(active
                        ? { maxHeight: 90, opacity: 1, marginTop: 10 }
                        : { maxHeight: 0, opacity: 0, marginTop: 0 }),
                    }}
                  >
                    <span
                      style={{
                        font: "var(--text-body-sm)",
                        color: "rgba(255,255,255,0.55)",
                        maxWidth: 300,
                        display: "block",
                      }}
                    >
                      {b.body}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <ChatCard
            stage={stage}
            blocks={blocks}
            height="clamp(360px,62vh,500px)"
            justify="flex-end"
          />
        </div>
      </div>
    </div>
  );
}
