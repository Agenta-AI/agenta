import {
  House,
  Lightning,
  Compass,
  Chats,
  SquaresFour,
  Gear,
  Plus,
  MagnifyingGlass,
  Funnel,
  CaretUpDown,
  CaretLeft,
  SidebarSimple,
  Question,
  SlidersHorizontal,
  Broadcast,
  Sparkle,
  Wrench,
  Vault,
  HardDrives,
  Key,
  Link,
  ChartLineUp,
  Coins,
  Receipt,
  UsersThree,
  Buildings,
  FolderSimple,
  ShieldCheck,
  ClockCounterClockwise,
  User,
  BookOpen,
  Keyboard,
  CaretDown,
  Megaphone,
  ArrowsLeftRight,
  SignOut,
} from "./ph.jsx";
import {
  BotIcon,
  BuilderIcon,
  ChartColumnIcon,
  FoldIcon,
  UnfoldIcon,
} from "./icons.jsx";
import { AgentaWordmark } from "./logos.jsx";
import { AGENTS, SESSIONS, WORKSPACE, sessionsOf } from "./data.js";
import { AgentChip, Bullet, Ib, Mi, Pop, cx } from "./Common.jsx";

const Row = ({ icon, label, sel, onClick, children, style }) => (
  <div
    className={cx("bnav", sel && "sel")}
    role="button"
    tabIndex={0}
    onClick={onClick}
    style={style}
    onKeyDown={(e) => e.key === "Enter" && onClick?.()}
  >
    {icon}
    <span className="cut">{label}</span>
    {children}
  </div>
);

const SessionRow = ({ session, sel, onClick }) => (
  <div
    className={cx("srow2", sel && "sel")}
    role="button"
    tabIndex={0}
    onClick={onClick}
    onKeyDown={(e) => e.key === "Enter" && onClick()}
  >
    <Bullet status={session.status} />
    <span className="fade">{session.title}</span>
  </div>
);

const Collapse = ({ a, s }) => (
  <Ib
    label={s.collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
    onClick={() => a.set({ collapsed: !s.collapsed })}
  >
    <SidebarSimple size={16} />
  </Ib>
);

/** Workspace switcher and help, the foot of every rail. */
function WorkspaceFoot({ a }) {
  return (
    <div className="row g4 hx-foot">
      <Pop
        className="grow"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            className={cx("bnav hx-ws", open && "open")}
            onClick={toggle}
          >
            <span className="ws">{WORKSPACE.initials}</span>
            <span className="cut grow">{WORKSPACE.name}</span>
            <CaretUpDown size={14} className="hx-ico8" />
          </button>
        )}
        menuClass="hx-upmenu"
      >
        {(close) => (
          <>
            <div className="mh">Projects in {WORKSPACE.name}</div>
            <Mi
              cur
              onClick={close}
              icon={<span className="ws sm">{WORKSPACE.initials}</span>}
            >
              {WORKSPACE.name}
            </Mi>
            <Mi
              onClick={close}
              icon={
                <span className="ws sm" style={{ background: "#0F766E" }}>
                  CL
                </span>
              }
            >
              Client work
            </Mi>
            <div className="msep" />
            <Mi onClick={close} icon={<ArrowsLeftRight size={16} />}>
              Switch organization
            </Mi>
            <Mi onClick={close} icon={<Plus size={16} />}>
              New project
            </Mi>
            <div className="msep" />
            <Mi
              onClick={() => {
                close();
                a.settings("account");
              }}
              icon={<User size={16} />}
            >
              Account
            </Mi>
            <Mi onClick={close} icon={<SignOut size={16} />}>
              <span className="hx-red">Logout</span>
            </Mi>
          </>
        )}
      </Pop>
      <Pop
        trigger={({ toggle }) => (
          <Ib label="Help" onClick={toggle}>
            <Question size={16} />
          </Ib>
        )}
        menuClass="hx-upmenu hx-help"
        align="right"
      >
        {(close) => (
          <>
            <Mi onClick={close} icon={<BookOpen size={16} />}>
              Documentation
            </Mi>
            <Mi onClick={close} icon={<Keyboard size={16} />}>
              Keyboard shortcuts
            </Mi>
            <Mi onClick={close} icon={<Megaphone size={16} />}>
              What's new
            </Mi>
          </>
        )}
      </Pop>
    </div>
  );
}

/** The main rail (NavMenu + useMobileNavItems). */
export function MainRail({ a, s }) {
  const groups = ["support", "seo", "lead"].map((id) =>
    AGENTS.find((x) => x.id === id),
  );
  const page = s.page;
  return (
    <nav className={cx("side real", s.collapsed && "mini")} aria-label="Main">
      <div className="brand">
        {s.collapsed ? null : (
          <span className="hx-brand">
            <AgentaWordmark width={80} height={18} />
          </span>
        )}
        <Collapse a={a} s={s} />
      </div>
      <Row
        icon={<House size={16} />}
        label="Home"
        sel={page === "home"}
        onClick={a.home}
      />
      <Row
        icon={<BuilderIcon size={16} />}
        label="Builder"
        onClick={a.builder}
      />
      <Row
        icon={<BotIcon size={16} />}
        label="Agents"
        sel={page === "agents"}
        onClick={a.agents}
      >
        <span className="grow" />
        <button
          type="button"
          className="hx-rowact"
          aria-label="New agent"
          onClick={(e) => {
            e.stopPropagation();
            a.set({ page: "home", rail: "main", homeTab: null });
          }}
        >
          <Plus size={14} />
        </button>
      </Row>
      <Row
        icon={<Lightning size={16} />}
        label="Automations"
        sel={page === "automations"}
        onClick={a.automations}
      />
      <Row
        icon={<Compass size={16} />}
        label="Skills"
        sel={page === "skills"}
        onClick={a.skills}
      />
      <Row icon={<Chats size={16} />} label="Sessions">
        <span className="grow" />
        <span className="hx-rowact">
          <MagnifyingGlass size={14} />
        </span>
        <span className="hx-rowact">
          <Funnel size={14} />
        </span>
      </Row>
      {s.collapsed ? (
        <div className="grow" />
      ) : (
        <div className="sscroll">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="shead sh2">
                <span className="cut">{g.name}</span>
                <CaretDown size={12} />
                <span className="grow" />
                <button
                  type="button"
                  className="ib sm6 hov"
                  aria-label={`New session in ${g.name}`}
                  title="New session"
                  onClick={() => a.openSession(sessionsOf(g.id)[0].id, g.id)}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className="ib sm6 hov"
                  aria-label={`Open ${g.name}`}
                  title={`Open ${g.name}`}
                  onClick={() => a.openAgent(g.id)}
                >
                  <UnfoldIcon size={14} />
                </button>
              </div>
              {sessionsOf(g.id)
                .slice(0, 4)
                .map((ss) => (
                  <SessionRow
                    key={ss.id}
                    session={ss}
                    sel={page === "session" && s.session === ss.id}
                    onClick={() => a.openSession(ss.id, g.id)}
                  />
                ))}
            </div>
          ))}
        </div>
      )}
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
      >
        <span className="grow" />
        <span className="xs t3">{WORKSPACE.version}</span>
      </Row>
      {s.collapsed ? null : <WorkspaceFoot a={a} />}
    </nav>
  );
}

/** The agent sidebar (features/agent-sidebar). */
export function AgentRail({ a, s, agent }) {
  const list = sessionsOf(agent.id);
  const days = ["Today", "Yesterday", "Earlier"];
  return (
    <nav className="side real hx-agentrail" aria-label="Agent">
      <div className="brand" style={{ padding: "0 4px" }}>
        <Ib label="Back" onClick={a.home}>
          <CaretLeft size={16} />
        </Ib>
        <Collapse a={a} s={s} />
      </div>
      <div className="ahead">
        <Pop
          className="grow"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              className={cx("aswitch", open && "open")}
              onClick={toggle}
            >
              <AgentChip agent={agent} size={32} radius={8} />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span
                  className="cut"
                  style={{ fontSize: 14, lineHeight: "18px" }}
                >
                  {agent.name}
                </span>
                <span className="xs t2">Agent</span>
              </span>
              <CaretUpDown size={14} className="t3" />
            </button>
          )}
          menuClass="hx-agmenu"
        >
          {(close) => (
            <>
              <div className="find">
                <MagnifyingGlass size={14} />
                <span>Search agents</span>
              </div>
              {AGENTS.map((ag) => (
                <Mi
                  key={ag.id}
                  cur={ag.id === agent.id}
                  onClick={() => {
                    close();
                    a.openAgent(
                      ag.id,
                      s.page === "agent" ? s.view : "configuration",
                    );
                  }}
                  icon={
                    <AgentChip agent={ag} size={22} radius={5} glyph={13} />
                  }
                >
                  {ag.name}
                </Mi>
              ))}
            </>
          )}
        </Pop>
        <Ib
          label="Back to the main sidebar"
          onClick={() =>
            a.set({ rail: "main", page: s.page === "agent" ? "home" : s.page })
          }
        >
          <FoldIcon size={16} />
        </Ib>
      </div>
      <button
        type="button"
        className="newsess"
        onClick={() => a.openSession(list[0].id, agent.id)}
      >
        <Plus size={14} />
        New session
      </button>
      <Row
        icon={<SlidersHorizontal size={16} />}
        label="Configuration"
        sel={s.page === "agent" && s.view === "configuration"}
        onClick={() => a.openAgent(agent.id, "configuration")}
      />
      <Row
        icon={<Broadcast size={16} />}
        label="Channels"
        sel={s.page === "agent" && s.view === "channels"}
        onClick={() => a.openAgent(agent.id, "channels")}
      />
      <Row
        icon={<ChartColumnIcon size={16} />}
        label="Analytics"
        sel={s.page === "agent" && s.view === "analytics"}
        onClick={() => a.openAgent(agent.id, "analytics")}
      />
      <div className="shead hx-sesshead">
        <button
          type="button"
          className={cx(
            "hx-seslink",
            s.page === "agent" && s.view === "sessions" && "on",
          )}
          onClick={() => a.openAgent(agent.id, "sessions")}
        >
          Sessions <span className="t3">{list.length}</span>
        </button>
        <span className="grow" />
        <span className="hx-rowact">
          <MagnifyingGlass size={14} />
        </span>
        <span className="hx-rowact">
          <Funnel size={14} />
        </span>
      </div>
      <div className="sscroll">
        {days.map((d) => {
          const rows = list.filter((x) => x.day === d);
          if (!rows.length) return null;
          return (
            <div key={d}>
              <div className="shead">{d}</div>
              {rows.map((ss) => (
                <SessionRow
                  key={ss.id}
                  session={ss}
                  sel={s.page === "session" && s.session === ss.id}
                  onClick={() => a.openSession(ss.id, agent.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <WorkspaceFoot a={a} />
    </nav>
  );
}

export const SETTINGS_NAV = [
  [
    "Connections",
    [
      ["llms", "AI providers", Sparkle],
      ["tools", "Integrations", Wrench],
      ["secrets", "Secrets", Vault],
      ["mcp", "MCPs", HardDrives],
      ["channels", "Channels", Broadcast],
    ],
  ],
  [
    "Project",
    [
      ["apiKeys", "API keys", Key],
      ["webhooks", "Webhooks", Link],
      ["analytics", "Analytics", ChartLineUp],
    ],
  ],
  [
    "Organization",
    [
      ["credits", "Credits", Coins],
      ["billing", "Plan & billing", Receipt],
      ["members", "Members", UsersThree],
      ["orgs", "Organizations", Buildings],
      ["projects", "Projects", FolderSimple],
      ["access", "Access & security", ShieldCheck],
      ["audit", "Audit log", ClockCounterClockwise],
    ],
  ],
  [
    "Personal",
    [
      ["account", "Account", User],
      ["preferences", "Preferences", SlidersHorizontal],
    ],
  ],
];

/** The settings rail (settingsNavScope): it takes over the sidebar. */
export function SettingsRail({ a, s }) {
  return (
    <nav className="side real hx-setrail" aria-label="Settings">
      <div className="brand" style={{ padding: "0 4px" }}>
        <Ib label="Back" onClick={a.home}>
          <CaretLeft size={16} />
        </Ib>
        <Collapse a={a} s={s} />
      </div>
      <div className="sscroll">
        {SETTINGS_NAV.map(([title, items], i) => (
          <div key={title}>
            <div className={cx("hx-sethead", i === 0 && "first")}>{title}</div>
            {items.map(([key, label, Icon]) => (
              <Row
                key={key}
                icon={<Icon size={14} />}
                label={label}
                sel={s.settingsTab === key}
                onClick={() => a.settings(key)}
              />
            ))}
          </div>
        ))}
      </div>
      <WorkspaceFoot a={a} />
    </nav>
  );
}

export { SESSIONS };
