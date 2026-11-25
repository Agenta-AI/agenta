import { useState } from "react";
import {
  Plus,
  ArrowsOut,
  X,
  CaretLeft,
  CaretRight,
  CaretDown,
  MagnifyingGlass,
  FileText,
  Cpu,
  Wrench,
  Robot,
  Broadcast,
  Compass,
  LockSimple,
  Shield,
  GearSix,
  Cube,
  Toolbox,
  Hammer,
  Check,
  House,
  SlidersHorizontal,
  SidebarSimple,
  SquaresFour,
  ListBullets,
  Funnel,
  DotsThree,
  Lightning,
  DownloadSimple,
} from "./ph.jsx";
import { BotIcon, BuilderIcon, OrbArt } from "./icons.jsx";
import {
  BUILDER_CHATS,
  FILES,
  FILE_BODIES,
  SKILLS,
  agentById,
  sessionById,
} from "./data.js";
import { AppLogo, Ib, Mi, Pop, cx } from "./Common.jsx";
import { Composer } from "./Session.jsx";
import { ChannelList } from "./AgentPages.jsx";

/* ---------------------------------------------------------------- builder */

const SUGGEST = [
  [
    "Suggest improvements",
    "I read its sessions and propose the most useful changes",
  ],
  ["Check for problems", "I look for failed runs and missing connections"],
  ["Optimize", "I test it and try a cheaper model"],
  [
    "Explain how it works",
    "I summarize its instructions, tools and automations",
  ],
];
const SUGGEST_HOME = [
  [
    "Suggest improvements",
    "Clearer instructions, a missing tool or a skill for a task your agents repeat",
  ],
  [
    "Check for problems",
    "Failed sessions, automations that did not start and missing connections",
  ],
  ["Optimize an agent", "Test it, then try a cheaper or faster model"],
];

function CardFoot({ state, saves, onApprove, onDeny, onReset, savedLine }) {
  if (state === "approved")
    return (
      <div className="ccst">
        <span className="k add">
          <Check size={12} weight="bold" />
        </span>
        <div className="col grow" style={{ minWidth: 0 }}>
          <span className="b5 sm">Saved as {saves}</span>
          <span className="xs t2">{savedLine}</span>
        </div>
        <button type="button" className="btn ghost" onClick={onReset}>
          Revert
        </button>
      </div>
    );
  if (state === "denied")
    return (
      <div className="ccst">
        <span className="k">
          <X size={12} weight="bold" />
        </span>
        <div className="col grow" style={{ minWidth: 0 }}>
          <span className="b5 sm">You denied this change</span>
          <span className="xs t2">Nothing was saved.</span>
        </div>
        <button type="button" className="btn ghost" onClick={onReset}>
          Undo
        </button>
      </div>
    );
  return (
    <div className="ccf">
      <span className="xs t2 grow">Saves as {saves}</span>
      <button type="button" className="btn ghost" onClick={onDeny}>
        Deny
      </button>
      <button type="button" className="btn primary" onClick={onApprove}>
        Approve
      </button>
    </div>
  );
}

function SafariChat({ state, a }) {
  return (
    <>
      <div className="u">
        Why did Login fails on Safari get only medium urgency?
      </div>
      <div className="act">
        <button type="button" className="sum">
          Worked for 3 s<CaretRight size={10} weight="bold" className="car" />
        </button>
      </div>
      <div>
        <div className="who">
          <BuilderIcon size={12} />
          Builder
        </div>
        <p style={{ marginBottom: 8 }}>
          The instructions say that a bug is medium unless money is involved.
          Three other customers reported the same login bug this week, so many
          people are blocked.
        </p>
        <p style={{ marginBottom: 8 }}>
          I can add one rule: a bug that 3 or more customers report in a week is
          high.
        </p>
      </div>
      <div className="cc">
        <div className="cch">
          <span className="cck">
            <FileText size={14} />
          </span>
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="b6 sm">Edit the instructions</span>
            <span className="xs t2 cut">Instructions › AGENTS.md</span>
          </div>
        </div>
        <div className="ccd">
          <div className="ctx">
            <span className="g"> </span>
            <span>## Urgency</span>
          </div>
          <div className="del">
            <span className="g">−</span>
            <span>A bug is medium unless money is involved.</span>
          </div>
          <div className="add">
            <span className="g">+</span>
            <span>A bug is medium unless money is involved or 3 or more</span>
          </div>
          <div className="add">
            <span className="g">+</span>
            <span>customers report it in a week. Then it is high.</span>
          </div>
          <div className="ctx">
            <span className="g"> </span>
            <span>Billing problems are always high.</span>
          </div>
        </div>
        <button type="button" className="ccmore">
          View full diff · 14 lines
        </button>
        <CardFoot
          state={state}
          saves="v5"
          savedLine="1 change to Support triage"
          onApprove={() => a.card("safari", "approved")}
          onDeny={() => a.card("safari", "denied")}
          onReset={() => a.card("safari", "pending")}
        />
      </div>
    </>
  );
}

function NewAgentChat({ state, a }) {
  const seo = agentById("seo");
  const items = [
    [Cpu, "Model", "Claude Sonnet 5.5"],
    [FileText, "Instructions", "AGENTS.md · 41 words"],
    [Wrench, "Integrations", "Google Search Console, Notion"],
    [Compass, "Skills", "seo-brief-writer, brand-voice"],
    [Lightning, "Automation", "Every Monday at 08:00"],
  ];
  return (
    <>
      <div className="u">
        Build an agent that finds blog topics in our Search Console data, writes
        an SEO brief for each and drafts the post in Notion.
      </div>
      <div className="act">
        <button type="button" className="sum">
          Worked for 52 s<CaretRight size={10} weight="bold" className="car" />
        </button>
      </div>
      <div>
        <div className="who">
          <BuilderIcon size={12} />
          Builder
        </div>
        <p style={{ marginBottom: 8 }}>
          I built {seo.name}. Every Monday it reads Search Console, picks the
          keywords worth a post and saves a brief and a draft in Notion.
        </p>
        <p style={{ marginBottom: 8 }}>
          I tested it with 3 of your keywords. The briefs are in Files.
        </p>
      </div>
      <div className="cc">
        <div className="cch">
          <span className="cck">
            <BotIcon size={14} />
          </span>
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="b6 sm">Create an agent</span>
            <span className="xs t2 cut">{seo.name}</span>
          </div>
        </div>
        {items.map(([Icon, k, v]) => (
          <div className="cci ccr" key={k}>
            <span className="k add">
              <Plus size={12} weight="bold" />
            </span>
            <Icon size={14} className="t2" />
            <span className="b5 sm">{k}</span>
            <span className="xs t2 cut grow">{v}</span>
          </div>
        ))}
        <CardFoot
          state={state}
          saves="v1"
          savedLine={`Created ${seo.name}`}
          onApprove={() => {
            a.card("newseo", "approved");
            a.openAgent("seo", "configuration");
          }}
          onDeny={() => a.card("newseo", "denied")}
          onReset={() => a.card("newseo", "pending")}
        />
      </div>
    </>
  );
}

function PlainChat({ chat }) {
  return (
    <>
      <div className="u">{chat.q}</div>
      <div className="act">
        <button type="button" className="sum">
          Worked for 4 s<CaretRight size={10} weight="bold" className="car" />
        </button>
      </div>
      <div>
        <div className="who">
          <BuilderIcon size={12} />
          Builder
        </div>
        {chat.a.map((p) => (
          <p key={p} style={{ marginBottom: 8 }}>
            {p}
          </p>
        ))}
      </div>
    </>
  );
}

const ALL_CHATS = [
  {
    id: "newseo",
    title: "Create the SEO Content Agent",
    age: "5m",
    agent: "seo",
  },
  ...BUILDER_CHATS,
];

function PaneHeader({ a, title, onTitle, back }) {
  return (
    <div
      className="hdr"
      style={{ padding: back ? "0 8px 0 6px" : "0 8px 0 10px" }}
    >
      {back ? (
        <>
          <Ib label="Back" onClick={back}>
            <CaretLeft size={16} />
          </Ib>
          <span className="b6 grow" style={{ fontSize: 14 }}>
            {title}
          </span>
        </>
      ) : (
        <span className="pw" style={{ minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="seg2t"
            aria-haspopup="menu"
            onClick={onTitle}
          >
            <BuilderIcon size={14} />
            <span className="ttl cut" style={{ fontSize: 14 }}>
              {title}
            </span>
            <CaretDown size={12} className="t3" />
          </button>
        </span>
      )}
      <Ib label="New chat" onClick={() => a.set({ bview: "new" })}>
        <Plus size={16} />
      </Ib>
      <Ib label="Open in the builder">
        <ArrowsOut size={16} />
      </Ib>
      <Ib label="Close the builder" onClick={() => a.set({ panel: null })}>
        <X size={16} />
      </Ib>
    </div>
  );
}

export function BuilderPane({ a, s, ctxAgent }) {
  const [find, setFind] = useState("");
  const [draft, setDraft] = useState("");
  const chat = ALL_CHATS.find((c) => c.id === s.chat) ?? ALL_CHATS[1];
  const chatAgent = agentById(chat.agent);
  const ctx = ctxAgent ?? (s.bview === "chat" ? chatAgent : null);
  const sessionCtx = s.page === "session" ? sessionById(s.session).title : null;
  const chipText = ctx
    ? sessionCtx && ctxAgent
      ? `${ctx.name} · ${sessionCtx}`
      : ctx.name
    : null;
  const history = ALL_CHATS.filter((c) => !ctxAgent || c.agent === ctxAgent.id);
  const openChat = (id) => a.set({ bview: "chat", chat: id });
  const chip = chipText ? (
    <span className="ctxchip" title="The builder sees this">
      <BotIcon size={12} />
      <span className="cut">{chipText}</span>
      <button type="button" aria-label="Remove the context">
        <X size={12} />
      </button>
    </span>
  ) : null;

  if (s.bview === "history") {
    const rows = history.filter((c) =>
      c.title.toLowerCase().includes(find.toLowerCase()),
    );
    return (
      <aside className="bpane hx-rpane" aria-label="Builder">
        <PaneHeader
          a={a}
          title="Chat history"
          back={() => a.set({ bview: "chat" })}
        />
        <div className="bphist">
          <label className="find" style={{ margin: "0 0 8px" }}>
            <MagnifyingGlass size={14} />
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chats"
            />
          </label>
          {rows.length ? (
            rows.map((c) => (
              <button
                type="button"
                className="bprow"
                key={c.id}
                onClick={() => openChat(c.id)}
              >
                <span className="cut grow">{c.title}</span>
                <span className="xs t3">{c.age}</span>
              </button>
            ))
          ) : (
            <div className="hx-empty-line">No chat matches your search.</div>
          )}
        </div>
      </aside>
    );
  }

  if (s.bview === "new") {
    const list = ctxAgent ? SUGGEST : SUGGEST_HOME;
    return (
      <aside className="bpane hx-rpane" aria-label="Builder">
        <PaneHeader
          a={a}
          title="New chat"
          onTitle={() => a.set({ bview: "history" })}
        />
        <div className="bpempty">
          <div className="nchero">
            <OrbArt />
            <h1>
              {ctxAgent
                ? `What should we change in ${ctxAgent.name}?`
                : "What should we build?"}
            </h1>
            <p>
              {ctxAgent
                ? "I can change it, test it and explain how it works."
                : "Describe the job in plain words. I build the agent, test it with you and improve it."}
            </p>
          </div>
          <div className="composer" style={{ margin: 0, width: "100%" }}>
            {chip}
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                ctxAgent
                  ? "Ask for a change, a test or an explanation"
                  : "Describe the job, or pick a start below"
              }
              aria-label="Message the builder"
            />
            <div className="row g8">
              <span className="grow" />
              <button
                type="button"
                className={cx("send", !draft && "off")}
                aria-label="Send"
              >
                <BuilderSend />
              </button>
            </div>
          </div>
          <div className="bpsug">
            {list.map(([t, line]) => (
              <button
                type="button"
                className="bpsrow"
                key={t}
                onClick={() => setDraft(t)}
              >
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="sm b5">{t}</span>
                  <span className="xs t2 cut">{line}</span>
                </span>
                <CaretRight size={12} className="t3" />
              </button>
            ))}
          </div>
          <div className="bprecent">
            <div className="bprh">
              <span>Recent chats</span>
              <span className="grow" />
              <button
                type="button"
                className="lnk"
                onClick={() => a.set({ bview: "history" })}
              >
                View all
              </button>
            </div>
            {history.slice(0, 3).map((c) => (
              <button
                type="button"
                className="bprow"
                key={c.id}
                onClick={() => openChat(c.id)}
              >
                <span className="cut grow">{c.title}</span>
                <span className="xs t3">{c.age}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  const state = s.cards[chat.id] ?? "pending";
  return (
    <aside className="bpane hx-rpane" aria-label="Builder">
      <PaneHeader
        a={a}
        title={chat.title}
        onTitle={() => a.set({ bview: "history" })}
      />
      <div className="msgs" style={{ overflow: "auto" }} key={chat.id}>
        {chat.id === "safari" ? (
          <SafariChat state={state} a={a} />
        ) : chat.id === "newseo" ? (
          <NewAgentChat state={state} a={a} />
        ) : (
          <PlainChat chat={chat} />
        )}
      </div>
      <Composer
        placeholder="Ask for a change, a test or an explanation"
        style={{ margin: "0 16px 16px" }}
      >
        {chip}
      </Composer>
    </aside>
  );
}

const BuilderSend = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

/* ---------------------------------------------------------------- files */

const FOLDER = [
  { name: "AGENTS.md", kind: "MD", tone: "info", meta: "1.1 KB" },
  { name: "ticket-triage.md", kind: "MD", tone: "info", meta: "2.4 KB" },
  { name: "urgency-rules.md", kind: "MD", tone: "info", meta: "860 B" },
  { name: "labels.json", kind: "JSON", tone: "warning", meta: "410 B" },
];

const Glyph = ({ f, big }) =>
  f.kind === "folder" ? (
    <svg
      width={big ? 52 : 20}
      height={big ? 52 : 20}
      viewBox="0 0 256 256"
      fill="currentColor"
      className="hx-folder"
      aria-hidden="true"
    >
      <path d="M216 72h-84.7l-27.7-27.7A16 16 0 0 0 92.3 40H40a16 16 0 0 0-16 16v144.6A15.4 15.4 0 0 0 39.4 216h177.5a15.1 15.1 0 0 0 15.1-15.1V88a16 16 0 0 0-16-16Z" />
    </svg>
  ) : big ? (
    <span className="pfpage">
      <span className={cx("pfchip", f.tone)}>{f.kind}</span>
    </span>
  ) : (
    <span className={cx("hx-mini", f.tone)}>{f.kind}</span>
  );

export function FilesPane({ a, s }) {
  const [view, setView] = useState("grid");
  const [folder, setFolder] = useState(null);
  const [file, setFile] = useState(s.file);
  const items = folder ? FOLDER : FILES;
  const open = (f) =>
    f.kind === "folder" ? setFolder(f.name) : setFile(f.name);
  const back = () => (file ? setFile(null) : setFolder(null));
  const canBack = !!(file || folder);
  const body = file
    ? (FILE_BODIES[file] ?? [["p", "This file is empty."]])
    : null;
  return (
    <aside className="col slidex pfpane hx-rpane" aria-label="Files">
      <div className="pfr1">
        <Ib label="Close" onClick={() => a.set({ panel: null })}>
          <X size={15} />
        </Ib>
        <Ib
          label="Back"
          onClick={back}
          disabled={!canBack}
          style={{ opacity: canBack ? 1 : 0.5 }}
        >
          <CaretLeft size={15} weight="bold" />
        </Ib>
        <Ib label="Forward" style={{ opacity: 0.5 }}>
          <CaretRight size={15} weight="bold" />
        </Ib>
        <span className="pfcrumb">
          <button
            type="button"
            className="hx-crumbseg b5"
            onClick={() => {
              setFile(null);
              setFolder(null);
            }}
          >
            <House size={14} />
            All files
          </button>
          {folder ? (
            <>
              <span className="hx-sl">/</span>
              <button
                type="button"
                className="hx-crumbseg"
                onClick={() => setFile(null)}
              >
                {folder}
              </button>
            </>
          ) : null}
          {file ? (
            <>
              <span className="hx-sl">/</span>
              <span className="hx-crumbseg cut">{file}</span>
            </>
          ) : null}
        </span>
        <span className="grow" />
        <Ib label="View options">
          <SlidersHorizontal size={14} />
        </Ib>
        <Ib label="Show file tree">
          <SidebarSimple size={16} mirrored />
        </Ib>
      </div>
      {file ? (
        <div className="hx-fileview">
          <div className="hx-filebar">
            <Glyph
              f={
                (folder ? FOLDER : FILES).find((x) => x.name === file) ?? {
                  kind: "MD",
                  tone: "info",
                }
              }
            />
            <span className="b5 sm cut grow">{file}</span>
            <Ib label="Download">
              <DownloadSimple size={14} />
            </Ib>
          </div>
          <div className="hx-filebody">
            {body.map(([k, t], i) =>
              k === "h" ? (
                <h2 key={i}>{t}</h2>
              ) : k === "code" ? (
                <pre key={i}>{t}</pre>
              ) : (
                <p key={i}>{t}</p>
              ),
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="pfr2">
            <span className="pfpill">
              <button
                type="button"
                className={cx(view === "grid" && "on")}
                title="Grid"
                aria-label="Grid"
                onClick={() => setView("grid")}
              >
                <SquaresFour size={14} />
              </button>
              <button
                type="button"
                className={cx(view === "list" && "on")}
                title="List"
                aria-label="List"
                onClick={() => setView("list")}
              >
                <ListBullets size={14} />
              </button>
            </span>
            <button type="button" className="pfsort">
              <Funnel size={14} />
              Modified
              <CaretDown size={12} />
            </button>
            <span className="grow" />
            <Ib label="More actions" className="sm6">
              <DotsThree size={14} weight="bold" />
            </Ib>
          </div>
          {view === "grid" ? (
            <div className="pfgrid">
              {items.map((f) => (
                <button
                  type="button"
                  className="pftile"
                  key={f.name}
                  onClick={() => open(f)}
                >
                  <span className="pfglyph">
                    <Glyph f={f} big />
                  </span>
                  <span className="pfname">{f.name}</span>
                  <span className="pfmeta">{f.meta}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="hx-flist">
              {items.map((f) => (
                <button
                  type="button"
                  className="hx-frow"
                  key={f.name}
                  onClick={() => open(f)}
                >
                  <Glyph f={f} />
                  <span className="cut grow">{f.name}</span>
                  <span className="xs t3">{f.meta}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- configuration pane */

export const POLICIES = ["Allow", "Allow reads", "Ask", "Deny"];

function Acc({ icon, title, sum, add, open, onToggle, children }) {
  return (
    <div className={cx("acc", open && "open")}>
      <div
        className="acc-h"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => e.key === "Enter" && onToggle()}
      >
        {icon}
        <span className="acc-t">{title}</span>
        <span className="grow" />
        <span className="acc-s cut">{sum}</span>
        {add ? (
          <button
            type="button"
            className="ib sm6"
            aria-label="Add"
            onClick={(e) => e.stopPropagation()}
          >
            <Plus size={14} />
          </button>
        ) : null}
        <span className={cx("caret", !open && "r")} />
      </div>
      {open && children ? <div className="acc-b">{children}</div> : null}
    </div>
  );
}

const Irow = ({ icon, name, sub }) => (
  <div className="irow" role="button" tabIndex={0}>
    <span className="hx-irowmark">{icon}</span>
    <div className="grow" style={{ minWidth: 0 }}>
      <div className="cut" style={{ fontSize: 13 }}>
        {name}
      </div>
      {sub ? <div className="xs t2 cut">{sub}</div> : null}
    </div>
    <span className="caret r" />
  </div>
);

export function ConfigPane({ a, s, agent }) {
  const [tab, setTab] = useState("agent");
  const [open, setOpen] = useState({ instructions: true, integrations: true });
  const [policy, setPolicy] = useState(agent.permission);
  const [access, setAccess] = useState("Shared with project");
  const t = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const n = (list, one, many) =>
    list.length ? `${list.length} ${list.length === 1 ? one : many}` : "None";
  const ico = (I) => <I size={14} className="t2" />;
  return (
    <aside className="col slidex rpanel hx-rpane" aria-label="Configuration">
      <div
        className="gh"
        style={{ padding: "0 6px 0 4px", background: "var(--background)" }}
      >
        <div
          className="ltabs"
          role="tablist"
          style={{ gap: 14, marginLeft: 10 }}
        >
          {[
            ["agent", "Agent"],
            ["automations", "Automations"],
            ["channels", "Channels"],
            ["access", "Access"],
          ].map(([k, l]) => (
            <button
              type="button"
              role="tab"
              key={k}
              aria-selected={tab === k}
              className={cx(tab === k && "on")}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="grow" />
        <Ib label="Close" onClick={() => a.set({ panel: null })}>
          <X size={16} />
        </Ib>
      </div>
      <div className="col grow" style={{ minHeight: 0 }}>
        <div style={{ overflow: "auto", flex: 1 }}>
          {tab === "agent" ? (
            <div className="cfgin2">
              <Acc
                icon={ico(Cpu)}
                title="Model"
                sum={`${agent.model.harness} · ${agent.model.name}`}
                open={open.model}
                onToggle={() => t("model")}
              >
                <Irow
                  icon={<Cpu size={16} />}
                  name={agent.model.name}
                  sub={`${agent.model.id} · via ${agent.model.harness}`}
                />
              </Acc>
              <Acc
                icon={ico(FileText)}
                title="Instructions"
                sum=""
                open={open.instructions}
                onToggle={() => t("instructions")}
              >
                <div className="filecard" role="button" tabIndex={0}>
                  <span className="av" style={{ background: "#1f7a5a" }}>
                    <FileText size={14} />
                  </span>
                  <div className="grow">
                    <div className="row g8">
                      <span className="mono13">AGENTS.md</span>
                      <span className="xs t3">
                        {agent.instructions.words} words
                      </span>
                    </div>
                    <div className="xs t2 clamp2">
                      {agent.instructions.text}
                    </div>
                  </div>
                  <span className="caret r" />
                </div>
              </Acc>
              <Acc
                icon={ico(Wrench)}
                title="Integrations"
                sum={n(agent.integrations, "integration", "integrations")}
                add
                open={open.integrations}
                onToggle={() => t("integrations")}
              >
                {agent.integrations.length ? (
                  agent.integrations.map((x) => (
                    <Irow
                      key={x.name}
                      icon={<AppLogo slug={x.mark} name={x.name} />}
                      name={x.name}
                    />
                  ))
                ) : (
                  <div className="sm t3">No integrations yet</div>
                )}
              </Acc>
              <Acc
                icon={ico(Robot)}
                title="Subagents"
                sum="None"
                add
                open={open.subagents}
                onToggle={() => t("subagents")}
              >
                <div className="sm t3">No subagents yet</div>
              </Acc>
              <Acc
                icon={ico(Broadcast)}
                title="MCP servers"
                sum="None"
                add
                open={open.mcp}
                onToggle={() => t("mcp")}
              >
                <div className="sm t3">No MCP servers yet</div>
              </Acc>
              <Acc
                icon={ico(Compass)}
                title="Skills"
                sum={n(agent.skills, "skill", "skills")}
                add
                open={open.skills}
                onToggle={() => t("skills")}
              >
                {agent.skills.length ? (
                  agent.skills.map((id) => {
                    const sk = SKILLS.find((x) => x.id === id);
                    return (
                      <Irow
                        key={id}
                        icon={<Compass size={16} />}
                        name={sk.title}
                        sub={sk.desc}
                      />
                    );
                  })
                ) : (
                  <div className="sm t3">No skills yet</div>
                )}
              </Acc>
              <Acc
                icon={ico(LockSimple)}
                title="Secrets"
                sum={
                  agent.secrets.length
                    ? `${agent.secrets.length} attached`
                    : "None"
                }
                add
                open={open.secrets}
                onToggle={() => t("secrets")}
              >
                {agent.secrets.length ? (
                  agent.secrets.map((x) => (
                    <Irow
                      key={x.name}
                      icon={<LockSimple size={16} />}
                      name={<span className="mono13">{x.name}</span>}
                      sub={x.sub}
                    />
                  ))
                ) : (
                  <div className="sm t3">No custom secrets attached.</div>
                )}
              </Acc>
              <Acc
                icon={ico(Shield)}
                title="Permissions"
                sum={`Policy · ${policy}`}
                open={open.perm}
                onToggle={() => t("perm")}
              >
                <div className="irow" style={{ cursor: "default" }}>
                  <span className="grow sm">
                    What the agent may do without asking
                  </span>
                  <PolicySelect value={policy} onChange={setPolicy} />
                </div>
              </Acc>
              <Acc
                icon={ico(GearSix)}
                title="Advanced"
                sum=""
                open={open.adv}
                onToggle={() => t("adv")}
              >
                <Irow
                  icon={<Cube size={16} />}
                  name="Execution"
                  sub="Daytona sandbox"
                />
                <Irow
                  icon={<Toolbox size={16} />}
                  name="Agenta tools"
                  sub="Files, sessions and memory"
                />
                <Irow
                  icon={<Hammer size={16} />}
                  name="Build kit"
                  sub="The tools the builder uses"
                />
              </Acc>
            </div>
          ) : tab === "automations" ? (
            <div className="hx-panebody">
              {[...agent.automations.scheduled, ...agent.automations.app]
                .length ? (
                [...agent.automations.scheduled, ...agent.automations.app].map(
                  (x) => (
                    <Irow
                      key={x.name}
                      icon={<Lightning size={16} />}
                      name={x.name}
                      sub={x.when}
                    />
                  ),
                )
              ) : (
                <div className="sm t3">No automations yet</div>
              )}
              <button
                type="button"
                className="btn"
                style={{ alignSelf: "flex-start" }}
              >
                <Plus size={14} />
                Add automation
              </button>
            </div>
          ) : tab === "channels" ? (
            <div className="hx-panebody">
              <ChannelList agent={agent} compact />
            </div>
          ) : (
            <div className="hx-panebody">
              <div className="sm b5">Who can see this agent</div>
              {[
                ["Private", "Only you can see and use it in Agenta."],
                [
                  "Shared with project",
                  "Everyone in Acme Agency can see and use it.",
                ],
              ].map(([k, d]) => (
                <button
                  type="button"
                  key={k}
                  className={cx("radio", access === k && "on")}
                  onClick={() => setAccess(k)}
                >
                  <span className="rd" />
                  <span className="col">
                    <span className="b5 sm">{k}</span>
                    <span className="xs t2">{d}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="df" style={{ justifyContent: "flex-end" }}>
        <span className="row g8">
          <button type="button" className="btn ghost">
            History
          </button>
          <button type="button" className="btn hx-saved" disabled>
            Saved as {agent.version}
          </button>
        </span>
      </div>
    </aside>
  );
}

export function PolicySelect({ value, onChange }) {
  return (
    <Pop
      align="right"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          className={cx("pop", open && "open")}
          onClick={toggle}
        >
          {value}
          <CaretDown size={12} className="t3" />
        </button>
      )}
      menuClass="hx-w200"
    >
      {(close) =>
        POLICIES.map((p) => (
          <Mi
            key={p}
            cur={value === p}
            onClick={() => {
              onChange(p);
              close();
            }}
          >
            {p}
          </Mi>
        ))
      }
    </Pop>
  );
}
