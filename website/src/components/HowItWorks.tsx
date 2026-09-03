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
 * Desktop + motion allowed: a tall (SECTION_VH) section with a position:sticky, 100vh inner
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

// Scroll length of the pinned stage. The 6 stages are mapped across
// (SECTION_VH − 100vh) of scroll, so each beat advances every
// (SECTION_VH − 100) / 6 vh. Smaller = snappier (less scrolling per beat).
// Was 500 (~67vh/beat); 320 is ~37vh/beat — tune here if beats fly by / drag.
const SECTION_VH = 320;

// Stage at which each of the 7 message blocks first appears (dc: revealAt).
const REVEAL_AT = [0, 1, 2, 3, 4, 5, 5];

// Base wrapper style for each message block (the part before the reveal toggle).
const BLOCK_BASE: CSSProperties[] = [
  { flexDirection: "column", alignItems: "flex-end", gap: 6 },
  {
    flexDirection: "column",
    gap: 9,
    borderTop: "1px solid var(--hiw-block-rule)",
    paddingTop: 12,
  },
  { flexDirection: "column", gap: 8 },
  { flexDirection: "column", alignItems: "flex-end", gap: 6 },
  {
    flexDirection: "column",
    gap: 9,
    borderTop: "1px solid var(--hiw-block-rule)",
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
      className="hiw-toolrow"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "9px 13px",
        borderRadius: 8,
        background: "var(--hiw-tool-bg)",
        boxShadow: "inset 0 0 0 1px var(--hiw-tool-ring)",
      }}
    >
      <GreenCheck />
      <span
        className="hiw-toolrow-label"
        style={{
          font: "var(--app-text-mono)",
          fontSize: 12,
          color: "var(--hiw-tool-label)",
        }}
      >
        {label}
      </span>
      <span
        className="hiw-toolrow-meta"
        style={{
          marginLeft: "auto",
          font: `400 12px/1 ${GEIST}`,
          color: "var(--hiw-tool-meta)",
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
        color: "var(--hiw-ts)",
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
              color: "var(--hiw-ts)",
            }}
          >
            2m ago{" "}
            <span style={{ fontWeight: 600, color: "var(--hiw-ts-you)" }}>
              YOU
            </span>
          </span>
          <div
            style={{
              maxWidth: "78%",
              padding: "11px 15px",
              borderRadius: 10,
              background: "var(--hiw-bub-bg)",
              boxShadow: "inset 0 0 0 1px var(--hiw-bub-ring)",
              font: `400 13.5px/1.55 ${GEIST}`,
              color: "var(--hiw-bub-text)",
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
              color: "var(--hiw-thought)",
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
              color: "var(--hiw-body)",
            }}
          >
            Onboarding completion is{" "}
            <span style={{ color: "var(--hiw-body-hi)", fontWeight: 500 }}>64%</span>, down
            4% week over week. Biggest drop-off is step 3, connect data source.
            I updated{" "}
            <span
              style={{
                font: "var(--app-text-mono)",
                fontSize: 12,
                color: "var(--hiw-code-text)",
                background: "var(--hiw-code-bg)",
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
              color: "var(--hiw-meta)",
            }}
          >
            2m ago{" "}·{" "}5.3s{" "}·{" "}28.3K tokens
            {" "}·{" "}$0.14
          </span>
        </div>
      );
    case 3:
      return (
        <div key="b3" style={wrap}>
          <span
            style={{
              font: `400 11px/1 ${GEIST}`,
              color: "var(--hiw-ts)",
            }}
          >
            now{" "}
            <span style={{ fontWeight: 600, color: "var(--hiw-ts-you)" }}>
              YOU
            </span>
          </span>
          <div
            style={{
              maxWidth: "78%",
              padding: "11px 15px",
              borderRadius: 10,
              background: "var(--hiw-bub-bg)",
              boxShadow: "inset 0 0 0 1px var(--hiw-bub-ring)",
              font: `400 13.5px/1.55 ${GEIST}`,
              color: "var(--hiw-bub-text)",
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
              background: "var(--hiw-sched-bg)",
              boxShadow: "inset 0 0 0 1px var(--hiw-sched-ring)",
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
              <span
                style={{
                  font: `500 13.5px/1 ${GEIST}`,
                  color: "var(--hiw-sched-title)",
                }}
              >
                Agent scheduled
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
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
                  color: "var(--hiw-sched-meta)",
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
            style={{ flex: 1, height: 1, background: "var(--hiw-div-line)" }}
          />
          <span
            style={{
              font: "var(--app-text-mono)",
              fontSize: 11,
              color: "var(--hiw-div-text)",
            }}
          >
            Monday 09:00 — ran while you were out
          </span>
          <span
            style={{ flex: 1, height: 1, background: "var(--hiw-div-line)" }}
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
              color: "var(--hiw-body)",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 9px",
                borderRadius: 6,
                background: "var(--hiw-flag-bg)",
                boxShadow: "var(--hiw-flag-shadow)",
                font: `500 11.5px/1 ${GEIST}`,
                color: "var(--hiw-flag-text)",
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
              color: "var(--hiw-meta)",
            }}
          >
            Mon 09:02{" "}·{" "}41s{" "}·{" "}12.1K tokens
            {" "}·{" "}$0.06
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
          borderLeft: "1px solid var(--hiw-files-border)",
          background: "var(--hiw-files-bg)",
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
            borderBottom: "1px solid var(--hiw-files-hdr-border)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--hiw-files-ico)"
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
              color: "var(--hiw-files-title)",
            }}
          >
            Files
          </span>
          <span
            style={{
              marginLeft: "auto",
              font: `400 11px/1 ${GEIST}`,
              color: "var(--hiw-files-count)",
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
                      background: "var(--hiw-file-hot-bg)",
                      boxShadow: "inset 0 0 0 1px var(--hiw-file-hot-ring)",
                    }
                  : {}),
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={f.hot ? "var(--hiw-file-ico-hot)" : "var(--hiw-file-ico)"}
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
                    color: f.hot
                      ? "var(--hiw-file-name-hot)"
                      : "var(--hiw-file-name)",
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
                      ? "var(--hiw-file-meta-hot)"
                      : "var(--hiw-file-meta)",
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
        background: "var(--hiw-comp-bg)",
        boxShadow: "inset 0 0 0 1px var(--hiw-comp-ring)",
        padding: "13px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <span
        style={{
          font: `400 13.5px/1 ${GEIST}`,
          color: "var(--hiw-comp-ph)",
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
          stroke="var(--hiw-comp-ico)"
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
            color: "var(--hiw-comp-hint)",
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
            background: "var(--hiw-send-bg)",
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
              stroke="var(--hiw-send-arrow)"
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
  // Scroll layout only: the thread is bottom-anchored (justify:flex-end) and
  // grows upward as stages reveal, so it overflows the top. Clip it here and
  // fade the top edge so messages dissolve into the card instead of being cut
  // by a hard overflow slice. The static layout (auto height, flex-start) has
  // no overflow, so it needs no mask.
  const scrolled = justify === "flex-end";
  const TOP_FADE = "linear-gradient(to bottom, transparent 0, #000 52px)";
  return (
    <div
      style={{
        height,
        minWidth: 0,
        borderRadius: 12,
        background: "var(--hiw-card-bg)",
        boxShadow: "var(--hiw-card-shadow)",
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
            ...(scrolled
              ? {
                  overflow: "hidden",
                  WebkitMaskImage: TOP_FADE,
                  maskImage: TOP_FADE,
                }
              : {}),
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
      {/* The shared eyebrow (components/Badge.astro) by its CSS class: this is a
          React island, so it cannot render the Astro component itself. */}
      <span className="ag-badge ag-badge--default">How it works</span>
      <h2
        style={{
          margin: 0,
          font: "var(--text-display-lg)",
          color: "var(--hiw-h2)",
          textWrap: "pretty",
        }}
      >
        Do the work in chat. Then automate it.
      </h2>
      <p
        style={{
          margin: 0,
          font: "var(--text-body-md)",
          color: "var(--hiw-sub)",
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
        stroke="var(--hiw-chev)"
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
  // Scroll/resize events fire faster than the display refreshes; we coalesce a
  // burst into a single rAF so the one layout read (getBoundingClientRect) and
  // stage check happen at most once per frame. That keeps the main thread free
  // during fast scrolls instead of forcing a reflow on every raw event.
  useEffect(() => {
    if (!scroll) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      const next = Math.min(5, Math.floor(p * 6));
      setStage((prev) => (prev !== next ? next : prev));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const onResize = () => {
      setShortViewport(window.innerHeight < 700);
      schedule();
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    measure();
    onResize();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
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
                color: "var(--hiw-beat-on)",
              }}
            >
              {label}
            </span>
            <span
              style={{
                font: "var(--text-body-sm)",
                color: "var(--hiw-beat-body)",
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
    <div
      ref={sectionRef}
      style={{ height: `${SECTION_VH}vh`, boxSizing: "border-box" }}
    >
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
                    borderTop: "1px solid var(--hiw-beat-border)",
                    ...(i === BEATS.length - 1
                      ? { borderBottom: "1px solid var(--hiw-beat-border)" }
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
                        color: active
                          ? "var(--hiw-beat-on)"
                          : "var(--hiw-beat-off)",
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
                        color: "var(--hiw-beat-body)",
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
