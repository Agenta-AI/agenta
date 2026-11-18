import { useEffect, useRef, useState } from "react";
import {
  CaretDown,
  ChatCircle,
  Chats,
  Compass,
  DotsThree,
  FunnelSimple,
  GearSix,
  House,
  Lightning,
  Plus,
  Question,
  Robot,
  SidebarSimple,
  SquaresFour,
  Tray,
} from "@phosphor-icons/react";

// The product sidebar: org switcher, page links, the Sessions list (pinned, then
// grouped by agent), credits, and Settings. The hero renders it as static HTML
// (clicks wired by its inline script through `data-go`); the live demo renders
// the same component with `onGo`, so both look the same.
const NAV = [
  { label: "Home", icon: House, go: { view: "home" } },
  { label: "Inbox", icon: Tray },
  { label: "Agents", icon: Robot, go: { view: "agents" } },
  { label: "Templates", icon: SquaresFour, href: "/marketplace" },
  { label: "Automations", icon: Lightning, go: { view: "automations" } },
  { label: "Skills", icon: Compass, go: { view: "skills" } },
  { label: "More", icon: DotsThree, muted: true },
];

const STATUS_LABEL = {
  running: "Running",
  waiting: "Waiting for you",
  unread: "Unread",
  failed: "Failed",
};

function Status({ status }) {
  if (!status) return null;
  return (
    <span
      className={`dsb-status dsb-status--${status}`}
      role="img"
      aria-label={STATUS_LABEL[status]}
    />
  );
}

export default function DemoSidebar({
  groups,
  selected,
  collapsed = false,
  onGo,
  onToggleCollapse,
}) {
  const [closed, setClosed] = useState({});
  const list = useRef(null);
  // Keep the open session in view inside the scrolling list.
  useEffect(() => {
    const row = list.current?.querySelector('[aria-current="page"]');
    if (!row) return;
    const box = list.current.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom)
      list.current.scrollTop += r.top - box.top - (box.height - r.height) / 2;
  }, [selected]);
  const go = (detail) => (onGo ? () => onGo(detail) : undefined);
  const goAttr = (detail) => (detail ? JSON.stringify(detail) : undefined);
  const rowDetail = (group, row) =>
    row.live
      ? { live: true }
      : {
          view: "playground",
          session: group.sessionIndex,
          playgroundTask: row.ask,
        };
  const pinned = groups.flatMap((group) =>
    group.rows.filter((row) => row.pinned).map((row) => ({ group, row })),
  );
  const sessionRow = (group, row) => {
    const detail = rowDetail(group, row);
    return (
      <button
        type="button"
        key={row.name}
        className="dsb-session"
        aria-current={selected === row.name ? "page" : undefined}
        data-go={goAttr(detail)}
        onClick={go(detail)}
      >
        <span className="dsb-label">{row.name}</span>
        <Status status={row.status} />
      </button>
    );
  };

  return (
    <aside
      className="dsb"
      data-collapsed={collapsed || undefined}
      aria-label="Demo workspace"
    >
      <div className="dsb-top">
        <span className="dsb-org">
          <span className="dsb-avatar">A</span>
          <span className="dsb-label dsb-org-name">Acme</span>
          <CaretDown size={12} className="dsb-org-caret" aria-hidden="true" />
        </span>
        <button
          type="button"
          className="dsb-icon-btn"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          data-dsb-toggle=""
          onClick={onToggleCollapse}
        >
          <SidebarSimple size={16} aria-hidden="true" />
        </button>
      </div>

      <nav className="dsb-nav">
        {NAV.map(({ label, icon: Icon, go: detail, href, muted }) => {
          const props = {
            className: `dsb-row${muted ? " dsb-row--muted" : ""}`,
            "aria-current": selected === label.toLowerCase() ? "page" : undefined,
            title: collapsed ? label : undefined,
          };
          const body = (
            <>
              <Icon size={16} aria-hidden="true" />
              <span className="dsb-label">{label}</span>
            </>
          );
          return href ? (
            <a key={label} href={href} {...props}>
              {body}
            </a>
          ) : (
            <button
              type="button"
              key={label}
              {...props}
              data-go={goAttr(detail)}
              onClick={go(detail)}
              aria-disabled={detail ? undefined : "true"}
            >
              {body}
            </button>
          );
        })}
      </nav>

      <div className="dsb-rule" />

      <div className="dsb-sessions">
        <div className="dsb-sessions-head">
          <button
            type="button"
            className="dsb-row"
            aria-current={selected === "sessions" ? "page" : undefined}
            data-go={goAttr({ view: "sessions" })}
            onClick={go({ view: "sessions" })}
          >
            <Chats size={16} aria-hidden="true" />
            <span className="dsb-label">Sessions</span>
          </button>
          <span className="dsb-icon-btn dsb-hide-rail" aria-hidden="true">
            <FunnelSimple size={16} />
          </span>
        </div>
        <div className="dsb-list" ref={list}>
          {pinned.length > 0 && (
            <>
              <p className="dsb-section">Pinned</p>
              {pinned.map(({ group, row }) => sessionRow(group, row))}
            </>
          )}
          {groups.map((group) => {
            const isClosed = closed[group.agent];
            const rows = group.rows.filter((row) => !row.pinned);
            return (
              <div key={group.agent} className="dsb-group">
                <div className="dsb-group-head">
                  <button
                    type="button"
                    className="dsb-group-toggle"
                    aria-expanded={!isClosed}
                    onClick={() =>
                      setClosed((state) => ({
                        ...state,
                        [group.agent]: !isClosed,
                      }))
                    }
                  >
                    <span>{group.agent}</span>
                    <CaretDown size={12} aria-hidden="true" />
                  </button>
                  <span className="dsb-icon-btn" aria-hidden="true">
                    <Plus size={14} />
                  </span>
                </div>
                {!isClosed && rows.map((row) => sessionRow(group, row))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="dsb-foot">
        <div className="dsb-credits">
          <div>
            <span>Credits</span>
            <span>4,120 of 5,000</span>
          </div>
          <span className="dsb-bar">
            <i style={{ width: "82.4%" }} />
          </span>
        </div>
        <div className="dsb-settings">
          <span className="dsb-row" title={collapsed ? "Settings" : undefined}>
            <GearSix size={16} aria-hidden="true" />
            <span className="dsb-label">Settings</span>
          </span>
          <span className="dsb-icon-btn dsb-hide-rail" aria-hidden="true">
            <ChatCircle size={16} />
          </span>
          <span className="dsb-icon-btn dsb-hide-rail" aria-hidden="true">
            <Question size={16} />
          </span>
        </div>
      </div>
    </aside>
  );
}
