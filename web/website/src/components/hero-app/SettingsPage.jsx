import { useState } from "react";
import {
  ArrowSquareOut,
  Plus,
  DotsThreeVertical,
  Key,
  X,
  Link as LinkIcon,
  HardDrives,
  ClockCounterClockwise,
  Check,
} from "./ph.jsx";
import {
  API_KEYS,
  AGENTS,
  CLOUDS,
  MEMBERS,
  PROVIDERS,
  ROLES,
  WORKSPACE,
} from "./data.js";
import { AnalyticsView } from "./AgentPages.jsx";
import { platformLogo } from "./logos.jsx";
import {
  AppLogo,
  Avatar,
  Ib,
  Mi,
  Pop,
  Switch,
  cx,
  initialsOf,
} from "./Common.jsx";
import { SETTINGS_NAV } from "./Sidebars.jsx";
import { ProvidersPage, IntegrationsPage } from "./Providers.jsx";

// Docs links: web/packages/agenta-settings/src/navigation.ts (main).
const DOCS_BASE = "https://docs.agenta.ai";
const DOCS = {
  llms: `${DOCS_BASE}/faq/integrations/llm-providers`,
  tools: `${DOCS_BASE}/concepts/tools-and-integrations`,
  apiKeys: `${DOCS_BASE}/reference/api-guide/overview`,
  members: `${DOCS_BASE}/administration/access-control/rbac`,
  orgs: `${DOCS_BASE}/administration/access-control/organizations`,
  projects: `${DOCS_BASE}/administration/access-control/organizations`,
  access: `${DOCS_BASE}/administration/access-control/sso`,
};

// Subtitles and docs links: web/packages/agenta-i18n/locales/en/settingsTabs.json (main).
const COPY = {
  llms: [
    "Connect the AI providers your agents, prompts, and evaluations run on.",
    "Learn more about AI providers",
  ],
  tools: [
    "Connect the integrations your agents can use.",
    "Learn more about integrations",
  ],
  secrets: ["Store credentials your agents use at runtime."],
  mcp: [
    "MCP servers connected to this project. Each agent chooses which of these to use and what it may run.",
  ],
  channels: [
    "Chat platforms connected to this project. Each connection answers as one agent.",
  ],
  apiKeys: [
    "Manage API keys used to authenticate requests.",
    "Learn more about the API",
  ],
  webhooks: [
    "Send workflow events to your own HTTP endpoints, with signed payloads and delivery retries.",
  ],
  analytics: [
    "See what your agents cost, how often they run, and how reliably they finish.",
  ],
  credits: [
    "What your organization has left, where it went, and how to add more.",
  ],
  billing: ["Your plan, its limits, and payment details."],
  members: [
    "Manage members, invitations, and access.",
    "Learn more about roles",
  ],
  orgs: ["Every organization you belong to.", "Learn more about organizations"],
  projects: [
    "Organize agents, datasets, and deployments.",
    "Learn more about projects",
  ],
  access: [
    "Control how members sign in and which email domains are allowed to join this organization.",
    "Learn more about SSO",
  ],
  audit: ["Review changes made across your organization."],
  account: [
    "Your personal profile. These details are visible to other members of your organizations.",
  ],
  preferences: [
    "Personal settings stored in this browser. They are not shared with your organizations.",
  ],
};

const label = (key) =>
  SETTINGS_NAV.flatMap(([, items]) => items).find(([k]) => k === key)?.[1] ??
  "Settings";

function Shell({ tab, actions, children }) {
  const [sub, docs] = COPY[tab] ?? [""];
  return (
    <div className="hx-scroll">
      <div className="hx-set">
        <div className="hx-sethd">
          <div className="row g8">
            <h1>{label(tab)}</h1>
            <span className="grow" />
            {actions}
          </div>
          <p>
            {sub}
            {docs ? (
              <>
                {" "}
                <a
                  href={DOCS[tab]}
                  target="_blank"
                  rel="noreferrer"
                  className="hx-link"
                >
                  {docs}
                  <ArrowSquareOut size={12} />
                </a>
              </>
            ) : null}
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Members({ invite, setInvite }) {
  const [rows, setRows] = useState(MEMBERS);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Editor");
  const send = () => {
    if (!email.includes("@")) return;
    setRows((r) => [
      ...r,
      {
        name: email.split("@")[0],
        email,
        role,
        status: "Pending",
        added: "Nov 25, 2026",
      },
    ]);
    setEmail("");
    setInvite(false);
  };
  return (
    <>
      <div className="hx-table hx-memtbl">
        <div className="hx-th">
          <span>Member</span>
          <span>Role</span>
          <span>Status</span>
          <span>Added</span>
          <span />
        </div>
        {rows.map((m) => (
          <div className="hx-tr" key={m.email}>
            <span className="row g8" style={{ minWidth: 0 }}>
              <Avatar initials={initialsOf(m.name)} size={28} />
              <span className="col" style={{ minWidth: 0 }}>
                <span className="row g6">
                  <span className="b5 cut">{m.name}</span>
                  {m.you ? <span className="hx-tag">You</span> : null}
                </span>
                <span className="t2 cut" style={{ fontSize: 12.5 }}>
                  {m.email}
                </span>
              </span>
            </span>
            <span>
              {m.role === "Owner" ? (
                <span className="sm">Owner</span>
              ) : (
                <Pop
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      className="btn ghost hx-rolebtn"
                      onClick={toggle}
                    >
                      {m.role}
                    </button>
                  )}
                  menuClass="hx-w200"
                >
                  {(c) =>
                    ROLES.filter((r) => r !== "Owner").map((r) => (
                      <Mi
                        key={r}
                        cur={r === m.role}
                        onClick={() => {
                          setRows((all) =>
                            all.map((x) =>
                              x.email === m.email ? { ...x, role: r } : x,
                            ),
                          );
                          c();
                        }}
                      >
                        {r}
                      </Mi>
                    ))
                  }
                </Pop>
              )}
            </span>
            <span>
              <span
                className={cx(
                  "hx-status",
                  m.status === "Active" ? "ok" : "wait",
                )}
              >
                {m.status}
              </span>
            </span>
            <span className="sm t2">{m.added}</span>
            <span>
              {m.you ? null : (
                <Pop
                  align="right"
                  trigger={({ toggle }) => (
                    <Ib label="Actions" className="sm6" onClick={toggle}>
                      <DotsThreeVertical size={14} weight="bold" />
                    </Ib>
                  )}
                  menuClass="hx-w200"
                >
                  {(c) => (
                    <>
                      <Mi onClick={c}>Rename</Mi>
                      {m.status === "Pending" ? (
                        <Mi onClick={c}>Resend invitation</Mi>
                      ) : (
                        <Mi onClick={c}>Reset password</Mi>
                      )}
                      <div className="msep" />
                      <Mi
                        onClick={() => {
                          setRows((all) =>
                            all.filter((x) => x.email !== m.email),
                          );
                          c();
                        }}
                      >
                        <span className="hx-red">Remove</span>
                      </Mi>
                    </>
                  )}
                </Pop>
              )}
            </span>
          </div>
        ))}
      </div>
      {invite ? (
        <>
          <div className="mask" onClick={() => setInvite(false)} />
          <div
            className="hx-dialog hx-dialog-sm"
            role="dialog"
            aria-label="Invite members"
          >
            <div className="hx-dlg-h">
              <div className="col grow">
                <span className="hx-dlg-t">Invite members</span>
                <span className="sm t2">
                  They join this organization once they accept.
                </span>
              </div>
              <Ib label="Close" onClick={() => setInvite(false)}>
                <X size={16} />
              </Ib>
            </div>
            <div className="hx-dlg-b">
              <label className="col g6">
                <span className="hx-flabel">Email</span>
                <input
                  className="field"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                />
              </label>
              <div className="col g6">
                <span className="hx-flabel">Role</span>
                <Pop
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      className="field hx-selectfield"
                      onClick={toggle}
                    >
                      {role}
                    </button>
                  )}
                  menuClass="hx-w200"
                >
                  {(c) =>
                    ROLES.filter((r) => r !== "Owner").map((r) => (
                      <Mi
                        key={r}
                        cur={r === role}
                        onClick={() => {
                          setRole(r);
                          c();
                        }}
                      >
                        {r}
                      </Mi>
                    ))
                  }
                </Pop>
              </div>
            </div>
            <div className="hx-dlg-f">
              <span className="grow" />
              <button
                type="button"
                className="btn ghost"
                onClick={() => setInvite(false)}
              >
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={send}>
                Send invitation
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function ApiKeys({ rows }) {
  return (
    <div className="hx-table hx-keytbl">
      <div className="hx-th">
        <span>API key</span>
        <span>Created</span>
        <span>Expires</span>
        <span>Last used</span>
        <span />
      </div>
      {rows.map((k) => (
        <div className={cx("hx-tr", k.fresh && "flash")} key={k.key}>
          <span className="row g8">
            <Key size={14} className="t2" />
            <span className="mono13">{k.key}</span>
          </span>
          <span className="sm t2">{k.created}</span>
          <span className="sm t2">{k.expires}</span>
          <span className="sm t2">{k.used}</span>
          <span>
            <Ib label="Actions" className="sm6">
              <DotsThreeVertical size={14} weight="bold" />
            </Ib>
          </span>
        </div>
      ))}
    </div>
  );
}

const Empty = ({ icon, title, body, action }) => (
  <div className="hx-emptybox">
    <span className="hx-emptyic">{icon}</span>
    <span className="b5">{title}</span>
    <span className="sm t2" style={{ maxWidth: 420 }}>
      {body}
    </span>
    {action}
  </div>
);

function Simple({ rows }) {
  return (
    <div className="cpc">
      {rows.map(([icon, name, sub, right]) => (
        <div className="cpr" key={name}>
          {icon ? <span className="cpl t2">{icon}</span> : null}
          <div className="col grow" style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14 }}>{name}</span>
            {sub ? <span className="xs t2 cut">{sub}</span> : null}
          </div>
          {right}
        </div>
      ))}
    </div>
  );
}

export function SettingsPage({ s }) {
  const tab = s.settingsTab;
  const [prefs, setPrefs] = useState({ dev: false });
  const [invite, setInvite] = useState(false);
  const [keys, setKeys] = useState(API_KEYS);
  const newKey = () =>
    setKeys((r) => [
      {
        key: "ag-Zp3n…8sWd",
        created: "Nov 25, 2026",
        expires: "Never",
        used: "Never used",
        fresh: true,
      },
      ...r,
    ]);
  let body;
  let actions = null;
  if (tab === "llms") body = <ProvidersPage />;
  else if (tab === "tools") body = <IntegrationsPage />;
  else if (tab === "members") {
    actions = (
      <button
        type="button"
        className="btn primary hx-btn32"
        onClick={() => setInvite(true)}
      >
        <Plus size={14} />
        Invite members
      </button>
    );
    body = <Members invite={invite} setInvite={setInvite} />;
  } else if (tab === "apiKeys") {
    actions = (
      <button type="button" className="btn primary hx-btn32" onClick={newKey}>
        <Plus size={14} />
        Generate key
      </button>
    );
    body = <ApiKeys rows={keys} />;
  } else if (tab === "analytics") body = <AnalyticsView workspace />;
  else if (tab === "secrets") {
    actions = (
      <button type="button" className="btn primary hx-btn32">
        <Plus size={14} />
        Add secret
      </button>
    );
    body = (
      <Simple
        rows={[
          [
            <Key size={16} />,
            <span className="mono13">ZENDESK_SUBDOMAIN</span>,
            "Used by Support triage",
            <span className="sm t2">Oct 2, 2026</span>,
          ],
          [
            <Key size={16} />,
            <span className="mono13">BILLING_API_KEY</span>,
            "Used by Support triage",
            <span className="sm t2">Nov 8, 2026</span>,
          ],
        ]}
      />
    );
  } else if (tab === "channels") {
    body = (
      <Simple
        rows={AGENTS.filter((ag) => ag.channels.slack).map((ag) => [
          platformLogo("slack", 20),
          "Slack",
          `Answers as ${ag.name}`,
          <span className="hx-pill on">
            <Check size={11} weight="bold" />
            Connected
          </span>,
        ])}
      />
    );
  } else if (tab === "mcp")
    body = <Empty icon={<HardDrives size={16} />} title="No MCP servers yet" />;
  else if (tab === "webhooks")
    body = (
      <Empty
        icon={<LinkIcon size={16} />}
        title="No webhooks yet"
        body="Subscribe an endpoint to receive workflow events as signed HTTP requests."
      />
    );
  else if (tab === "credits") {
    body = (
      <div className="col" style={{ gap: 16 }}>
        <div className="hx-two">
          <div className="pacard">
            <span className="hx-cardt">Credits left</span>
            <span className="hx-val" style={{ marginTop: 6 }}>
              $41.20
            </span>
            <span className="xs t2">of $100 this month</span>
            <div className="hx-meter">
              <i style={{ width: "59%" }} />
            </div>
          </div>
          <div className="pacard">
            <span className="hx-cardt">Used this month</span>
            <span className="hx-val" style={{ marginTop: 6 }}>
              $58.80
            </span>
            <span className="xs t2">Support triage used the most</span>
          </div>
        </div>
        <button
          type="button"
          className="btn"
          style={{ alignSelf: "flex-start" }}
        >
          <Plus size={14} />
          Add credits
        </button>
      </div>
    );
  } else if (tab === "billing") {
    body = (
      <div className="col" style={{ gap: 16 }}>
        <div className="pacard">
          <div className="row">
            <span className="hx-cardt">Plan</span>
            <span className="grow" />
            <button type="button" className="btn hx-compact">
              Change plan
            </button>
          </div>
          <span className="hx-val" style={{ marginTop: 6 }}>
            Pro
          </span>
          <span className="xs t2">$49 per month · renews Dec 3, 2026</span>
        </div>
        <Simple
          rows={[
            [null, "Agents", "5 of unlimited", null],
            [null, "Members", "4 of 10", null],
            [
              null,
              "Payment details",
              "Managed in the Stripe billing portal.",
              <button type="button" className="btn hx-compact">
                Open portal
              </button>,
            ],
          ]}
        />
      </div>
    );
  } else if (tab === "orgs")
    body = (
      <Simple
        rows={[
          [
            <Avatar initials="AA" size={24} />,
            WORKSPACE.name,
            "Owner · 4 members",
            <span className="hx-tag">Current</span>,
          ],
        ]}
      />
    );
  else if (tab === "projects")
    body = (
      <Simple
        rows={[
          [
            null,
            WORKSPACE.name,
            "5 agents · default project",
            <span className="hx-tag">Current</span>,
          ],
          [null, "Client work", "2 agents", null],
        ]}
      />
    );
  else if (tab === "access")
    body = (
      <Simple
        rows={[
          [
            null,
            "Email and password",
            "Members can sign in with their email and a password",
            <Switch on onChange={() => {}} label="Email and password" />,
          ],
          [
            null,
            "Social login",
            "Allow sign-in with Google, GitHub, or other OAuth providers",
            <Switch on={false} onChange={() => {}} label="Social login" />,
          ],
          [
            null,
            "Verified domains",
            "Prove you own a domain to auto-join its members and restrict invitations to it.",
            <button type="button" className="btn hx-compact">
              Add domain
            </button>,
          ],
        ]}
      />
    );
  else if (tab === "audit")
    body = (
      <Simple
        rows={[
          [
            <ClockCounterClockwise size={16} />,
            "Sam Ortiz changed Lead Qualifier",
            "Saved v7 · 3 days ago",
            null,
          ],
          [
            <ClockCounterClockwise size={16} />,
            "Maya Brooks invited jonas@acme-agency.com",
            "Nov 21, 2026",
            null,
          ],
          [
            <ClockCounterClockwise size={16} />,
            "Maya Brooks created an API key",
            "Oct 2, 2026",
            null,
          ],
        ]}
      />
    );
  else if (tab === "account")
    body = (
      <Simple
        rows={[
          [
            <Avatar initials={WORKSPACE.user.initials} size={28} />,
            WORKSPACE.user.name,
            WORKSPACE.user.email,
            <button type="button" className="btn hx-compact">
              Edit
            </button>,
          ],
        ]}
      />
    );
  else
    body = (
      <Simple
        rows={[
          [
            null,
            "Developer mode",
            "Show Evaluation, Prompt Management, and Tracing in the navigation.",
            <Switch
              on={prefs.dev}
              onChange={(v) => setPrefs({ dev: v })}
              label="Developer mode"
            />,
          ],
        ]}
      />
    );
  return (
    <Shell tab={tab} actions={actions}>
      {body}
    </Shell>
  );
}
