// The Builder page (web/mobile/src/features/builder-page on main): the builder sidebar, a new
// chat in the middle (NewBuilderChat, PageQuickActions, the composer) and the agent pane.
import { useEffect, useRef, useState } from "react";
import {
  CaretLeft,
  CaretUpDown,
  CaretDown,
  SidebarSimple,
  Plus,
  MagnifyingGlass,
  X,
  ArrowsOutSimple,
  Paperclip,
  Microphone,
  ArrowUp,
  Robot,
} from "./ph.jsx";
import { BuilderIcon } from "./icons.jsx";
import { BuilderRing } from "./BuilderRing.jsx";
import { AgentPaneBody } from "./Panes.jsx";
import { WorkspaceFoot, Row } from "./Sidebars.jsx";
import { SquaresFour, Gear } from "./ph.jsx";
import { BUILDER_CHATS, FILES, WORKSPACE, sessionsOf } from "./data.js";
import { Bullet, Ib, cx } from "./Common.jsx";

/** The prompt the tour types into the composer. It is never sent. */
export const BUILD_PROMPT =
  "Build an agent that finds blog topics in our Search Console data and drafts the posts in Notion.";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** builderSidebarScope.tsx: Back, the Builder switcher, New chat, then the chats. */
export function BuilderRail({ a, s }) {
  return (
    <nav className="side real hx-builderrail" aria-label="Builder">
      <div className="brand" style={{ padding: "0 4px" }}>
        <button type="button" className="hx-back" onClick={a.home}>
          <CaretLeft size={14} />
          Back
        </button>
        <Ib
          label="Collapse the sidebar"
          onClick={() => a.set({ collapsed: true })}
        >
          <SidebarSimple size={16} />
        </Ib>
      </div>
      <div className="ahead">
        <button type="button" className="aswitch">
          <span className="hx-bswitch-ic">
            <BuilderIcon size={18} />
          </span>
          <span className="grow cut" style={{ fontSize: 14, fontWeight: 500 }}>
            Builder
          </span>
          <CaretUpDown size={14} className="t3" />
        </button>
      </div>
      <button type="button" className="newsess">
        <Plus size={14} />
        New chat
      </button>
      <div className="shead hx-sesshead">
        <span style={{ fontSize: 12 }}>Chats</span>
        <span className="grow" />
        <span className="hx-rowact">
          <MagnifyingGlass size={14} />
        </span>
      </div>
      <div className="sscroll">
        <div className="shead">Today</div>
        <div className="srow2 sel" role="button" tabIndex={0}>
          <Bullet status="idle" />
          <span className="fade">New chat</span>
        </div>
        <div className="shead">Earlier</div>
        {BUILDER_CHATS.slice(0, 4).map((c) => (
          <div
            className="srow2"
            role="button"
            tabIndex={0}
            key={c.id}
            onClick={() =>
              a.set({
                page: "home",
                rail: "main",
                panel: "builder",
                bview: "chat",
                chat: c.id,
              })
            }
          >
            <Bullet status="idle" />
            <span className="fade">{c.title}</span>
          </div>
        ))}
      </div>
      <Row
        icon={<SquaresFour size={16} />}
        label="Templates"
        onClick={() =>
          a.set({ page: "home", rail: "main", homeTab: "templates" })
        }
      />
      <Row
        icon={<Gear size={16} />}
        label="Settings"
        onClick={() => a.settings()}
      ></Row>
      <WorkspaceFoot a={a} />
    </nav>
  );
}

/** The Anthropic mark of the composer's model button. */
const AnthropicMark = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
  </svg>
);

// The requests the quick actions put in the composer (builder.page.json on main).
const QUICK = [
  [
    "Suggest improvements",
    "Look at my agents, their automations and their recent sessions. Suggest the changes that would help most: clearer instructions, a missing tool or connection, a skill for a task they repeat, or a step that people often correct. List them from most to least useful, and ask me before you change anything.",
  ],
  [
    "Check for problems",
    "Check my agents and automations for problems. Look at the last 7 days: failed sessions, runs that stopped early, automations that did not start, and connections that are missing or expired. For each problem, tell me what broke, why, and how to fix it. Fix it after I approve.",
  ],
  [
    "Optimize an agent",
    "Optimize SEO Content Agent. Write 3 test requests from its recent sessions, run them and check the answers. Then run the same requests on a cheaper or faster model and tell me if the answers stay as good. Show me the cost and the answers side by side before you change the model.",
  ],
  ["More ideas", null],
];

function NewChat({ autoType }) {
  const ring = useRef(null);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const userTyped = useRef(false);
  useEffect(() => {
    if (!autoType) return undefined;
    // Reduced motion: the prompt is there at once, with no typing.
    if (reducedMotion()) {
      setText(BUILD_PROMPT);
      return undefined;
    }
    let i = 0;
    let timer = 0;
    // A short wait, then one character at a time, with small pauses after spaces and commas.
    const next = () => {
      if (userTyped.current) {
        setTyping(false);
        return;
      }
      i += 1;
      setText(BUILD_PROMPT.slice(0, i));
      ring.current?.pulse();
      if (i >= BUILD_PROMPT.length) {
        setTyping(false);
        return;
      }
      const ch = BUILD_PROMPT[i - 1];
      timer = window.setTimeout(
        next,
        ch === " " ? 40 : ch === "," ? 103 : 22 + Math.random() * 17,
      );
    };
    timer = window.setTimeout(() => {
      setTyping(true);
      next();
    }, 515);
    return () => window.clearTimeout(timer);
  }, [autoType]);
  const heroState = typing || text.trim() ? "typing" : "idle";
  return (
    <div className="hx-bnew">
      <div className="hx-bnew-hero">
        {/* The canvas hero box is 236 px high (B01): the title sits under it. */}
        <div className="hx-ringbox">
          <BuilderRing ref={ring} state={heroState} size={180} />
        </div>
        <h1>What should we build?</h1>
        <p>
          Describe the job in plain words. I build the agent, test it with you
          and improve it.
        </p>
      </div>
      <div className="hx-bnew-bottom">
        <div className="hx-quick">
          {QUICK.map(([label, request]) => (
            <button
              type="button"
              key={label}
              onClick={() => {
                if (!request) return;
                userTyped.current = true;
                setText(request);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="composer hx-bcomp">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => {
              userTyped.current = true;
              setText(e.target.value);
              ring.current?.pulse();
            }}
            placeholder="Describe the job, or pick a start below"
            aria-label="Message the builder"
          />
          <div className="row g8">
            <Microphone size={16} className="t2" />
            <Paperclip size={16} className="t2" />
            <span className="grow" />
            <button type="button" className="hx-modelbtn">
              <AnthropicMark />
              opus[1m]
              <CaretDown size={12} className="t3" />
            </button>
            <button
              type="button"
              className="send"
              aria-label="Send"
              data-hx-send
            >
              <ArrowUp size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PANE_TABS = [
  ["agent", "Agent"],
  ["automations", "Automations"],
  ["channels", "Channels"],
  ["access", "Access"],
  ["drives", "Drives"],
  ["sessions", "Sessions"],
];

function BuilderAgentPane({ a, agent, onHide }) {
  const [tab, setTab] = useState("agent");
  const sessions = sessionsOf(agent.id);
  return (
    <section className="hx-bpane" aria-label="Open items">
      <div className="hx-bpane-h">
        <div className="hx-btab on" role="button" tabIndex={0}>
          <Robot size={14} />
          <span className="cut grow">{agent.name}</span>
          <button
            type="button"
            aria-label={`Close ${agent.name}`}
            className="hx-btab-x"
            onClick={onHide}
          >
            <X size={12} />
          </button>
        </div>
        <Ib label="Open an item">
          <Plus size={16} />
        </Ib>
        <span className="grow" />
        <span className="hx-vsep16" />
        <Ib label="Full screen">
          <ArrowsOutSimple size={16} />
        </Ib>
        <Ib label="Hide open items" onClick={onHide}>
          <SidebarSimple size={16} mirrored />
        </Ib>
      </div>
      <div className="hx-bpane-tabs" role="tablist">
        {PANE_TABS.map(([k, l]) => (
          <button
            type="button"
            role="tab"
            key={k}
            aria-selected={tab === k}
            className={cx(tab === k && "on")}
            onClick={() => setTab(k)}
          >
            {l}
            {k === "sessions" ? (
              <span className="hx-tabcount">{sessions.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="hx-scroll">
        {tab === "drives" ? (
          <div className="hx-flist">
            {FILES.map((f) => (
              <div className="hx-frow" key={f.name}>
                <span className={cx("hx-mini", f.tone ?? "info")}>
                  {f.kind === "folder" ? "DIR" : f.kind}
                </span>
                <span className="cut grow">{f.name}</span>
                <span className="xs t3">{f.meta}</span>
              </div>
            ))}
          </div>
        ) : tab === "sessions" ? (
          <div className="hx-flist">
            {sessions.map((x) => (
              <button
                type="button"
                className="hx-frow"
                key={x.id}
                onClick={() => a.openSession(x.id, agent.id)}
              >
                <Bullet status={x.status} />
                <span className="cut grow">{x.title}</span>
                <span className="xs t3">{x.day}</span>
              </button>
            ))}
          </div>
        ) : (
          <AgentPaneBody agent={agent} tab={tab} key={agent.id} />
        )}
      </div>
    </section>
  );
}

export function BuilderPageView({ a, agent, autoType }) {
  const [paneOpen, setPaneOpen] = useState(true);
  return (
    <div
      className="row grow"
      style={{ minHeight: 0, alignItems: "stretch", minWidth: 0 }}
    >
      <section
        className="col grow"
        style={{ minWidth: 0 }}
        aria-label="New chat"
      >
        <header className="hx-aph">
          <h1 className="grow">New chat</h1>
          {paneOpen ? null : (
            <Ib label="Open items" onClick={() => setPaneOpen(true)}>
              <SidebarSimple size={16} mirrored />
            </Ib>
          )}
        </header>
        <NewChat autoType={autoType} />
      </section>
      {paneOpen ? (
        <BuilderAgentPane
          a={a}
          agent={agent}
          onHide={() => setPaneOpen(false)}
        />
      ) : null}
    </div>
  );
}
