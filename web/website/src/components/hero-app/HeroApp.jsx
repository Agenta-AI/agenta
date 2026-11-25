// A clickable picture of the Agenta app (/m) for the website hero. Local state only.
// Layout and classes follow the builder design canvas (refs/builder-canvas) and the app on main.
import { useCallback, useState } from "react";
import { MainRail, AgentRail, SettingsRail } from "./Sidebars.jsx";
import { SessionView, ShareDialog } from "./Session.jsx";
import { BuilderPane, FilesPane, ConfigPane } from "./Panes.jsx";
import { HomePage, AgentsPage, SkillsPage, AutomationsPage } from "./Pages.jsx";
import { AgentPage } from "./AgentPages.jsx";
import { SettingsPage } from "./SettingsPage.jsx";
import { BuilderRail, BuilderPageView } from "./BuilderPage.jsx";
import { agentById } from "./data.js";
import "./hero-base.css";
import "./hero-app.css";

export const PRESETS = {
  // The hero: workspace home with the builder pane open on a proposed change.
  hero: {
    page: "home",
    rail: "main",
    panel: "builder",
    bview: "chat",
    chat: "safari",
  },
  // Tour steps.
  // The Builder page: a new chat with the prompt being typed, and the agent pane.
  build: {
    page: "builder",
    rail: "builder",
    agent: "seo",
    panel: null,
  },
  work: {
    page: "session",
    rail: "main",
    agent: "support",
    session: "charged",
    panel: "files",
    file: "reply-draft.md",
  },
  deploy: {
    page: "agent",
    rail: "agent",
    agent: "seo",
    view: "channels",
    panel: null,
  },
  govern: {
    page: "settings",
    rail: "settings",
    settingsTab: "analytics",
    panel: null,
  },
};

const BASE = {
  page: "home",
  rail: "main",
  agent: "support",
  view: "configuration",
  cfgTab: "agent",
  session: "charged",
  settingsTab: "llms",
  panel: null,
  bview: "chat",
  chat: "safari",
  cards: {},
  share: false,
  skill: null,
  file: null,
  collapsed: false,
};

export default function HeroApp({ preset = "hero", autoType = false }) {
  const [s, setS] = useState(() => ({
    ...BASE,
    ...(PRESETS[preset] ?? PRESETS.hero),
  }));
  const set = useCallback(
    (patch) =>
      setS((prev) => ({
        ...prev,
        ...(typeof patch === "function" ? patch(prev) : patch),
      })),
    [],
  );

  const a = {
    set,
    home: () => set({ page: "home", rail: "main", homeTab: null }),
    agents: () => set({ page: "agents", rail: "main", panel: null }),
    skills: () =>
      set({ page: "skills", rail: "main", panel: null, skill: null }),
    automations: () => set({ page: "automations", rail: "main", panel: null }),
    settings: (tab = "llms") =>
      set({
        page: "settings",
        rail: "settings",
        settingsTab: tab,
        panel: null,
      }),
    openAgent: (id, view = "configuration") =>
      set((p) => ({
        page: "agent",
        rail: "agent",
        agent: id,
        view,
        cfgTab: "agent",
        panel: p.panel === "builder" ? "builder" : null,
      })),
    openSession: (id, agent) =>
      set((p) => ({
        page: "session",
        session: id,
        agent,
        rail: p.rail === "agent" ? "agent" : "main",
      })),
    togglePanel: (name) =>
      set((p) => ({ panel: p.panel === name ? null : name })),
    builder: () =>
      set((p) => ({ panel: p.panel === "builder" ? null : "builder" })),
    card: (id, value) => set((p) => ({ cards: { ...p.cards, [id]: value } })),
  };

  const agent = agentById(s.agent);
  // The builder sees the agent on screen, or the chat's own agent on workspace pages.
  const ctxAgent = s.page === "agent" || s.page === "session" ? agent : null;

  let main;
  if (s.page === "home")
    main = <HomePage a={a} s={s} key={s.homeTab ?? "agents"} />;
  else if (s.page === "agents") main = <AgentsPage a={a} />;
  else if (s.page === "skills") main = <SkillsPage a={a} s={s} />;
  else if (s.page === "automations") main = <AutomationsPage a={a} />;
  else if (s.page === "settings") main = <SettingsPage a={a} s={s} />;
  else if (s.page === "agent") main = <AgentPage a={a} s={s} agent={agent} />;
  else if (s.page === "builder")
    main = <BuilderPageView a={a} agent={agent} autoType={autoType} />;
  else main = <SessionView a={a} s={s} agent={agent} />;

  let pane = null;
  if (s.panel === "builder")
    pane = <BuilderPane a={a} s={s} ctxAgent={ctxAgent} />;
  else if (s.panel === "files" && s.page === "session")
    pane = <FilesPane a={a} s={s} />;
  else if (s.panel === "config" && s.page === "session")
    pane = <ConfigPane a={a} s={s} agent={agent} />;

  const rail = s.collapsed ? (
    <MainRail a={a} s={s} />
  ) : s.rail === "settings" ? (
    <SettingsRail a={a} s={s} />
  ) : s.rail === "builder" ? (
    <BuilderRail a={a} s={s} />
  ) : s.rail === "agent" ? (
    <AgentRail a={a} s={s} agent={agent} />
  ) : (
    <MainRail a={a} s={s} />
  );

  return (
    <div
      className="hx scr ag-app-frame"
      data-page={s.page}
      data-panel={s.panel ?? "none"}
    >
      {rail}
      <div className="pane" role="region" aria-label="Main">
        <div
          className="row grow"
          style={{ minHeight: 0, alignItems: "stretch", minWidth: 0 }}
        >
          <div className="col grow hx-main" style={{ minWidth: 0 }}>
            {main}
          </div>
          {pane}
        </div>
      </div>
      {s.share ? <ShareDialog a={a} s={s} agent={agent} /> : null}
    </div>
  );
}
