import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../../../../web/packages/agenta-ui/src/components/ui/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../../../../web/packages/agenta-ui/src/components/ui/tabs";
import { SplitPane } from "../../../../../web/packages/agenta-ui/src/components/ui/split-pane";
import {
  Bot,
  MessageSquare,
  FileText,
  Folder,
  Globe,
  Monitor,
  LayoutGrid,
  Columns2,
  PanelLeft,
  Plus,
  ArrowRightLeft,
  X,
  ArrowUp,
  ChevronRight,
  Check,
  Moon,
  Sun,
  RotateCcw,
  Settings2,
  ExternalLink,
  GripVertical,
} from "lucide-react";
import "../../../../../web/packages/agenta-ui/src/styles/theme-variables.css";
import "./style.css";

type Kind =
  | "session"
  | "file"
  | "explorer"
  | "app"
  | "child"
  | "website"
  | "computer";
type Tab = { id: string; kind: Kind; title: string };
type Pane = { ids: string[]; active: string };
type State = {
  tabs: Tab[];
  panes: Pane[];
  focus: number;
  drafts: Record<string, string>;
  messages: Record<string, string[]>;
  cards: { id: number; text: string; stage: number }[];
};
const catalog: Tab[] = [
  { id: "launch", kind: "session", title: "Launch planning" },
  { id: "research", kind: "session", title: "Customer research" },
  { id: "brief", kind: "file", title: "launch-brief.md" },
  { id: "files", kind: "explorer", title: "Files" },
  { id: "board", kind: "app", title: "Launch board" },
  { id: "child", kind: "child", title: "Research assistant" },
  { id: "web", kind: "website", title: "Website preview" },
  { id: "computer", kind: "computer", title: "Computer" },
];
const icons = {
  session: MessageSquare,
  file: FileText,
  explorer: Folder,
  app: LayoutGrid,
  child: Bot,
  website: Globe,
  computer: Monitor,
};
const initial = (): State => ({
  tabs: catalog.filter((t) => ["launch", "research", "brief"].includes(t.id)),
  panes: [
    { ids: ["launch", "research"], active: "launch" },
    { ids: ["brief"], active: "brief" },
  ],
  focus: 0,
  drafts: {},
  messages: {},
  cards: [
    { id: 1, text: "Review launch copy", stage: 0 },
    { id: 2, text: "Record a product walkthrough", stage: 0 },
    { id: 3, text: "Prepare the announcement", stage: 1 },
    { id: 4, text: "Define the audience", stage: 2 },
  ],
});
const key = "agenta:playground-concept:v1";
function load() {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v?.panes?.length && v?.tabs && v?.cards ? v : initial();
  } catch {
    return initial();
  }
}
function Icon({ kind }: { kind: Kind }) {
  const I = icons[kind];
  return <I size={15} />;
}
function App() {
  const [state, set] = useState<State>(load),
    [size, setSize] = useState(Math.max(360, (window.innerWidth - 240) * 0.5)),
    [menu, setMenu] = useState<number | null>(null),
    [dark, setDark] = useState(false),
    [notice, setNotice] = useState(
      "Drag a tab to the other pane, or use “Move tab”.",
    ),
    [settings, setSettings] = useState(false);
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [state]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const focus = (n: number) =>
    set((s) => (s.focus === n ? s : { ...s, focus: n }));
  const open = (id: string, n: number) => {
    set((s) => {
      const at = s.panes.findIndex((p) => p.ids.includes(id));
      if (at >= 0)
        return {
          ...s,
          focus: at,
          panes: s.panes.map((p, i) => (i === at ? { ...p, active: id } : p)),
        };
      return {
        ...s,
        focus: n,
        tabs: s.tabs.some((t) => t.id === id)
          ? s.tabs
          : [...s.tabs, catalog.find((t) => t.id === id)!],
        panes: s.panes.map((p, i) =>
          i === n ? { ids: [...p.ids, id], active: id } : p,
        ),
      };
    });
    setMenu(null);
  };
  const move = (id: string, target: number, before?: string) => {
    set((s) => {
      const from = s.panes.findIndex((p) => p.ids.includes(id));
      if (from < 0 || id === before) return s;
      const panes = s.panes.map((p) => {
        const ids = p.ids.filter((t) => t !== id);
        return { ids, active: p.active === id ? ids[0] || "" : p.active };
      });
      if (!panes[target]) panes[target] = { ids: [], active: "" };
      const at = before ? panes[target].ids.indexOf(before) : -1;
      panes[target].ids.splice(at < 0 ? panes[target].ids.length : at, 0, id);
      panes[target].active = id;
      return { ...s, panes, focus: target };
    });
    setNotice(
      "Tab moved. Its conversation, draft, and file context stay the same.",
    );
  };
  const toggle = () => {
    set((s) =>
      s.panes.length === 1
        ? { ...s, panes: [...s.panes, { ids: [], active: "" }] }
        : {
            ...s,
            focus: 0,
            panes: [
              {
                ids: s.panes.flatMap((p) => p.ids),
                active: s.panes[s.focus].active || s.panes[0].active,
              },
            ],
          },
    );
    setNotice("Switch layouts without closing your tabs.");
  };
  const close = (n: number) =>
    set((s) => {
      const id = s.panes[n].active;
      return {
        ...s,
        panes: s.panes.map((p, i) =>
          i === n
            ? {
                ids: p.ids.filter((t) => t !== id),
                active: p.ids.find((t) => t !== id) || "",
              }
            : p,
        ),
      };
    });
  const updateDraft = (id: string, text: string) =>
    set((s) => ({ ...s, drafts: { ...s.drafts, [id]: text } }));
  const send = (id: string) => {
    if (!state.drafts[id]?.trim()) return;
    set((s) => ({
      ...s,
      messages: {
        ...s.messages,
        [id]: [...(s.messages[id] || []), s.drafts[id]],
      },
      drafts: { ...s.drafts, [id]: "" },
    }));
    setNotice(
      "Example message added locally. This concept does not call an agent.",
    );
  };
  const openOther = (id: string, n: number) => {
    if (state.panes.length === 1) {
      set((s) => ({ ...s, panes: [...s.panes, { ids: [], active: "" }] }));
      open(id, 1);
    } else open(id, n === 0 ? 1 : 0);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">a</div>agenta
        </div>
        <div className="workspace-name">
          Personal workspace <span>⌄</span>
        </div>
        <div className="navitem">
          <LayoutGrid size={16} /> Overview
        </div>
        <div className="navitem selected">
          <Bot size={16} /> Agents <span className="count">3</span>
        </div>
        <div className="navitem">
          <MessageSquare size={16} /> Sessions
        </div>
        <div className="navitem">
          <Folder size={16} /> Files
        </div>
        <div className="navlabel">YOUR AGENTS</div>
        <div className="agent selected">
          <div className="avatar small">
            <Bot size={17} />
          </div>
          Launch assistant
          <span className="dot" />
        </div>
        <div className="agent muted">
          <div className="avatar small gray">
            <Bot size={17} />
          </div>
          Research assistant
        </div>
        <div className="sidebar-note">
          A place to work
          <br />
          with your agents.
        </div>
        <div className="profile">
          <div className="avatar small gray">M</div>Mahmoud{" "}
          <span>Personal</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Agents <ChevronRight size={13} /> <strong>Launch assistant</strong>
          </div>
          <div className="header-actions">
            <span className="concept">Interactive concept</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setDark(!dark)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset demo"
              onClick={() => {
                set(initial());
                setNotice("Example workspace restored.");
              }}
            >
              <RotateCcw />
            </Button>
            <a
              href="https://github.com/Agenta-AI/agenta/pull/6775"
              target="_blank"
              rel="noreferrer"
            >
              Design PR <ExternalLink size={13} />
            </a>
          </div>
        </header>
        <div className="agent-header">
          <div className="avatar">
            <Bot size={23} />
          </div>
          <div>
            <h1>Launch assistant</h1>
            <p>Plan the launch. Build the things you need along the way.</p>
          </div>
          <Button variant="outline" onClick={() => setSettings(!settings)}>
            <Settings2 size={14} />
            Configuration
          </Button>
        </div>
        {settings && (
          <div className="settings">
            <strong>Agent configuration</strong>
            <span>
              Model: example model · Instructions: help prepare a product
              launch.
            </span>
            <span>
              Configuration stays outside the workspace in this concept.
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close configuration"
              onClick={() => setSettings(false)}
            >
              <X />
            </Button>
          </div>
        )}
        <div className="guide">
          <div>
            <span className="eyebrow">ONE WORKSPACE, DIFFERENT VIEWS</span>
            <h2>Your conversation, with your work beside it.</h2>
            <p>
              Open a file, compare sessions, or use an app. Every tab can live
              on either side.
            </p>
          </div>
          <div className="scenarios">
            <Button
              variant="outline"
              onClick={() => {
                set(initial());
                setNotice("Discuss the launch brief while reading it.");
              }}
            >
              <FileText size={14} />
              Conversation + file
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                set((s) => ({
                  ...s,
                  tabs: catalog,
                  focus: 1,
                  panes: [
                    { ids: ["launch", "brief"], active: "launch" },
                    { ids: ["board", "files"], active: "board" },
                  ],
                }));
                setNotice(
                  "Move a board card. The app and agent share the same example workspace.",
                );
              }}
            >
              <LayoutGrid size={14} />
              Conversation + app
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                set((s) => ({
                  ...s,
                  tabs: catalog,
                  focus: 1,
                  panes: [
                    { ids: ["launch"], active: "launch" },
                    { ids: ["research"], active: "research" },
                  ],
                }));
                setNotice(
                  "Two sessions are visible. Each keeps its own composer draft.",
                );
              }}
            >
              <MessageSquare size={14} />
              Two conversations
            </Button>
          </div>
        </div>
        <div className="workspace-toolbar">
          <div>
            <span className="dot" /> Playground <span className="muted">/</span>
            <span className="muted">
              {
                state.tabs.filter((t) =>
                  state.panes.some((p) => p.ids.includes(t.id)),
                ).length
              }{" "}
              open tabs
            </span>
          </div>
          <Button variant="ghost" onClick={toggle}>
            {state.panes.length === 2 ? (
              <PanelLeft size={15} />
            ) : (
              <Columns2 size={15} />
            )}{" "}
            {state.panes.length === 2 ? "One pane" : "Split view"}
          </Button>
        </div>
        <div className="workspace-frame">
          {state.panes.length === 2 ? (
            <SplitPane
              paneSide="start"
              paneSize={size}
              paneMin={280}
              paneMax={1800}
              fillMin={280}
              onResize={setSize}
              barLabel="Resize workspace panes"
              pane={renderPane(0)}
              fill={renderPane(1)}
            />
          ) : (
            renderPane(0)
          )}
        </div>
        <footer>
          <span className="status-message" role="status">
            <Check size={14} />
            {notice}
          </span>
          <span>Sample data · Saved in this browser</span>
        </footer>
      </main>
    </div>
  );
  function renderPane(n: number) {
    const pane = state.panes[n];
    return (
      <section
        className={"pane " + (state.focus === n ? "focused" : "")}
        aria-label={`Pane ${n + 1}`}
        onFocusCapture={() => focus(n)}
        onPointerDown={() => focus(n)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/tab");
          if (id) move(id, n);
        }}
      >
        <div className="pane-top">
          <span>
            {n === 0 ? "LEFT PANE" : "RIGHT PANE"}{" "}
            {state.focus === n && <b>Focused</b>}
          </span>
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Move selected tab to other pane"
              aria-label={`Move tab from pane ${n + 1}`}
              disabled={!pane.active}
              onClick={() => move(pane.active, n === 0 ? 1 : 0)}
            >
              <ArrowRightLeft size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Close selected tab"
              aria-label={`Close tab in pane ${n + 1}`}
              disabled={!pane.active}
              onClick={() => close(n)}
            >
              <X size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Add tab to pane ${n + 1}`}
              onClick={() => setMenu(menu === n ? null : n)}
            >
              <Plus size={15} />
            </Button>
          </div>
          {menu === n && (
            <div className="add-menu">
              <strong>Open a tab</strong>
              {catalog.map((t) => (
                <button key={t.id} onClick={() => open(t.id, n)}>
                  <Icon kind={t.kind} />
                  {t.title}
                  <span>{t.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Tabs
          value={pane.active}
          onValueChange={(id) =>
            set((s) => ({
              ...s,
              focus: n,
              panes: s.panes.map((p, i) =>
                i === n ? { ...p, active: id } : p,
              ),
            }))
          }
          className="pane-tabs"
        >
          <div className="tab-scroll">
            <TabsList className="mb-0 gap-5 px-4 w-max min-w-full">
              {pane.ids.map((id) => {
                const tab = state.tabs.find((t) => t.id === id)!;
                return (
                  <TabsTrigger
                    value={id}
                    key={id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/tab", id)}
                    onDrop={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      move(e.dataTransfer.getData("text/tab"), n, id);
                    }}
                  >
                    <Icon kind={tab.kind} />
                    {tab.title}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          {pane.ids.length === 0 ? (
            <div className="empty">
              <Columns2 size={30} />
              <h3>Room for another view</h3>
              <p>Drop a tab here or open something new.</p>
              <Button variant="outline" onClick={() => setMenu(n)}>
                <Plus size={14} />
                Open a tab
              </Button>
            </div>
          ) : (
            pane.ids.map((id) => (
              <TabsContent key={id} value={id} className="tab-body">
                {content(state.tabs.find((t) => t.id === id)!, n)}
              </TabsContent>
            ))
          )}
        </Tabs>
      </section>
    );
  }
  function content(tab: Tab, n: number) {
    if (tab.kind === "session" || tab.kind === "child") {
      const child = tab.kind === "child";
      return (
        <div className="conversation">
          <div className="transcript">
            <div className="session-meta">
              <span className="dot" />
              {child
                ? "Child execution · Read-only example"
                : "Session · " +
                  (tab.id === "launch" ? "Today, 10:24" : "Today, 09:10")}
              <span>Example</span>
            </div>
            <div className="user-message">
              {tab.id === "research"
                ? "What should we learn before the launch?"
                : child
                  ? "Research the audience for our launch."
                  : "Help me prepare the launch. Put together a short brief and a board to track the work."}
            </div>
            <div className="assistant-label">
              <div className="avatar tiny">
                <Bot size={13} />
              </div>
              {child ? "Research assistant" : "Launch assistant"}
            </div>
            <div className="assistant-message">
              <p>
                {tab.id === "research"
                  ? "I would start with three questions for our first users."
                  : child
                    ? "I reviewed the example audience notes. Here are the themes to bring back to the parent conversation."
                    : "I’ve prepared a launch brief and a small board. We can refine the message here while keeping the work in view."}
              </p>
              {tab.id === "research" ? (
                <ol>
                  <li>What work do they repeat every week?</li>
                  <li>Where do they need to stay in control?</li>
                  <li>What would make a first session useful?</li>
                </ol>
              ) : (
                <>
                  <button
                    className="resource-card"
                    onClick={() => openOther("brief", n)}
                  >
                    <div className="file-icon">
                      <FileText size={21} />
                    </div>
                    <div>
                      <strong>launch-brief.md</strong>
                      <span>Audience, message, and launch checklist</span>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className="resource-card"
                    onClick={() => openOther("board", n)}
                  >
                    <div className="file-icon purple">
                      <LayoutGrid size={21} />
                    </div>
                    <div>
                      <strong>Launch board</strong>
                      <span>Interactive example · board.json</span>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className="child-link"
                    onClick={() => openOther("child", n)}
                  >
                    <Bot size={14} />
                    Research assistant <span>Completed</span>
                    <ChevronRight size={13} />
                  </button>
                </>
              )}
              <p className="muted">
                {child
                  ? "This view represents one child call, not a new independent session."
                  : "What would you like to adjust first?"}
              </p>
            </div>
            {(state.messages[tab.id] || []).map((m, i) => (
              <React.Fragment key={i}>
                <div className="user-message">{m}</div>
                <p className="local-reply">
                  Message added to this example session. No agent was called.
                </p>
              </React.Fragment>
            ))}
          </div>
          {!child && (
            <div className="composer-wrap">
              <div className="composer">
                <textarea
                  aria-label={`Message ${tab.title}`}
                  placeholder="Ask, discuss, or make a change…"
                  value={state.drafts[tab.id] || ""}
                  onChange={(e) => updateDraft(tab.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(tab.id);
                    }
                  }}
                />
                <div>
                  <span>
                    <Plus size={14} /> Attach context
                  </span>
                  <Button
                    size="icon"
                    aria-label={`Send to ${tab.title}`}
                    disabled={!state.drafts[tab.id]?.trim()}
                    onClick={() => send(tab.id)}
                  >
                    <ArrowUp size={16} />
                  </Button>
                </div>
              </div>
              <small>This session keeps its draft when you move its tab.</small>
            </div>
          )}
        </div>
      );
    }
    if (tab.kind === "file")
      return (
        <div className="document">
          <div className="file-path">
            <Folder size={13} /> agent-files <ChevronRight size={12} />{" "}
            launch-brief.md <span>Preview</span>
          </div>
          <article>
            <span className="eyebrow">LAUNCH / WORKING DOCUMENT</span>
            <h2>
              A useful coworker.
              <br />
              On your terms.
            </h2>
            <p className="lede">
              A workspace for people who want AI to help with real work, while
              keeping control of their tools and models.
            </p>
            <hr />
            <h3>Who we’re building for</h3>
            <p>
              Founders and small teams who need help turning a growing list of
              tasks into finished work.
            </p>
            <h3>The first useful moment</h3>
            <p>
              Give an agent a concrete task. Review its work, open the files it
              creates, and make the next decision in the same place.
            </p>
            <blockquote>
              Keep the conversation and the work together.
            </blockquote>
            <h3>Launch checklist</h3>
            {[
              "Define the audience",
              "Review the launch copy",
              "Record a product walkthrough",
            ].map((t, i) => (
              <div className="checkrow" key={t}>
                <span className={i === 0 ? "checked" : ""}>
                  {i === 0 ? <Check size={11} /> : null}
                </span>
                {t}
              </div>
            ))}
            <div className="doc-foot">
              Example document · Linked to Launch planning
            </div>
          </article>
        </div>
      );
    if (tab.kind === "explorer")
      return (
        <div className="explorer">
          <div className="file-path">
            <Folder size={14} /> Launch assistant / agent-files
          </div>
          <h3>Workspace files</h3>
          <p className="muted">Open a file beside your conversation.</p>
          {[
            ["brief", "launch-brief.md", "Markdown document"],
            ["board", "todo.html", "Interactive board example"],
          ].map(([id, title, sub]) => (
            <button
              className="file-row"
              key={id}
              onClick={() => openOther(id, n)}
            >
              <FileText size={18} />
              <div>
                <strong>{title}</strong>
                <span>{sub}</span>
              </div>
              <ChevronRight size={15} />
            </button>
          ))}
          <details className="json">
            <summary>board.json</summary>
            <pre>{JSON.stringify(state.cards, null, 2)}</pre>
          </details>
        </div>
      );
    if (tab.kind === "app")
      return (
        <div className="board">
          <div className="file-path">
            <LayoutGrid size={14} /> todo.html <span>Demo app</span>
          </div>
          <div className="board-heading">
            <span className="eyebrow">LAUNCH ASSISTANT / APPS</span>
            <h2>Launch board</h2>
            <p>Small steps toward launch day.</p>
          </div>
          <div className="board-columns">
            {["To do", "In progress", "Done"].map((label, stage) => (
              <div className="board-column" key={label}>
                <h3>
                  <span className={"stage stage-" + stage} />
                  {label}
                  <span>
                    {state.cards.filter((c) => c.stage === stage).length}
                  </span>
                </h3>
                {state.cards
                  .filter((c) => c.stage === stage)
                  .map((c) => (
                    <div className="task" key={c.id}>
                      <GripVertical size={13} />
                      <p>{c.text}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Move ${c.text}`}
                        onClick={() =>
                          set((s) => ({
                            ...s,
                            cards: s.cards.map((x) =>
                              x.id === c.id
                                ? { ...x, stage: (stage + 1) % 3 }
                                : x,
                            ),
                          }))
                        }
                      >
                        {stage === 2 ? "Reopen" : "Move →"}
                      </Button>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div className="app-note">
            <Check size={14} />
            Card changes are shared with board.json in the Files tab.
          </div>
          <p className="app-boundary">
            Local example only. Running real HTML and granting file access is
            the separate proposal in{" "}
            <a
              href="https://github.com/Agenta-AI/agenta/pull/6529"
              target="_blank"
              rel="noreferrer"
            >
              #6529
            </a>
            .
          </p>
        </div>
      );
    return (
      <div className="empty">
        <Icon kind={tab.kind} />
        <h3>
          {tab.kind === "computer"
            ? "The agent’s computer"
            : "A website beside your work"}
        </h3>
        <p>
          {tab.kind === "computer"
            ? "A future remote desktop view could live in this tab. No computer is connected in this mockup."
            : "An embeddable website could live in this tab. This example does not load an external website."}
        </p>
        <span className="concept">Content placeholder</span>
        <p className="muted">Try moving this tab to the other pane.</p>
      </div>
    );
  }
}
createRoot(document.getElementById("root")!).render(<App />);
