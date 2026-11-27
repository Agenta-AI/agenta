// AI providers, the model picker and the integrations catalog, as the app draws them on main:
// ProviderListBody / ProvidersPanel / ProviderAddViewBody (AI providers), ModelPickerList and
// ComposerModelButton (model picker), IntegrationCatalog (Settings > Integrations).
import { useState } from "react";
import {
  Plus,
  DotsThreeVertical,
  Trash,
  PencilSimpleLine,
  CaretRight,
  CaretDown,
  Check,
  FadersHorizontal,
  MagnifyingGlass,
  Plugs,
  X,
} from "./ph.jsx";
import { PROVIDER_ICONS } from "./llmIcons.jsx";
import { WORKSPACE } from "./data.js";
import { AppLogo, Ib, Mi, Pop, cx } from "./Common.jsx";

/** providerIconFor(kind): the provider's logo, or Phosphor Plugs. */
export const ProviderIcon = ({ kind, size = 20, className }) => {
  const Icon = PROVIDER_ICONS[kind];
  return (
    <span
      className={cx("hx-pvicon", className)}
      style={{ width: size, height: size }}
    >
      {Icon ? <Icon /> : <Plugs size={size} />}
    </span>
  );
};

const Tag = ({ children, tone }) => (
  <span className={cx("hx-ptag", tone)}>{children}</span>
);

const RowMenu = () => (
  <Pop
    align="right"
    trigger={({ toggle }) => (
      <Ib label="More" className="sm6" onClick={toggle}>
        <DotsThreeVertical size={14} weight="bold" />
      </Ib>
    )}
    menuClass="hx-w200"
  >
    {(close) => (
      <>
        <Mi icon={<PencilSimpleLine size={14} />} onClick={close}>
          Edit
        </Mi>
        <div className="msep" />
        <Mi icon={<Trash size={14} />} onClick={close}>
          <span className="hx-red">Delete</span>
        </Mi>
      </>
    )}
  </Pop>
);

/* ---------------------------------------------------------------- AI providers */

const PROJECT_GROUPS = [
  ["Subscriptions", [{ kind: "anthropic", name: "Claude" }]],
  [
    "API keys",
    [
      { kind: "openai", name: "OpenAI" },
      { kind: "gemini", name: "Google Gemini" },
      { kind: "openrouter", name: "OpenRouter" },
    ],
  ],
];
const ORG_ROWS = [
  { kind: "openai", name: "OpenAI", sub: "OpenAI · Key saved · All projects" },
  {
    kind: "anthropic",
    name: "Anthropic",
    sub: `Anthropic · Key saved · ${WORKSPACE.name}`,
  },
  {
    kind: "bedrock",
    name: "AWS Bedrock",
    sub: "AWS Bedrock · Key saved · No projects",
  },
];
const CATALOG = [
  ["openai", "OpenAI"],
  ["mistral", "Mistral AI"],
  ["anthropic", "Anthropic"],
  ["openrouter", "OpenRouter"],
  ["gemini", "Google Gemini"],
  ["bedrock", "AWS Bedrock"],
  ["azure", "Azure OpenAI"],
  ["vertex_ai", "Google Vertex AI"],
  [
    "custom",
    "OpenAI-compatible endpoint",
    "Self-hosted or proxied models that speak the OpenAI API",
  ],
];

function AddProvider({ onClose }) {
  const [q, setQ] = useState("");
  const rows = CATALOG.filter(([, n]) =>
    n.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <>
      <div className="mask" onClick={onClose} />
      <div
        className="drawer hx-pvdrawer"
        role="dialog"
        aria-label="Add a provider or subscription"
      >
        <div className="dh">
          <span className="b6 grow">Add a provider or subscription</span>
          <Ib label="Close" onClick={onClose}>
            <X size={16} />
          </Ib>
        </div>
        <div className="hx-scroll">
          <div className="hx-pvgroup">Use a subscription</div>
          {[
            ["openai", "ChatGPT", "Sign in with your account"],
            ["anthropic", "Claude", "Paste a token from Claude Code"],
          ].map(([k, n, h]) => (
            <button type="button" className="hx-pick" key={n}>
              <ProviderIcon kind={k} />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="sm">{n}</span>
                <span className="hx-pickhint">{h}</span>
              </span>
              <CaretRight size={14} className="t3" />
            </button>
          ))}
          <div className="hx-pvgroup">Use an API key</div>
          <div style={{ padding: "4px 16px 8px" }}>
            <label className="hx-search" style={{ width: "100%" }}>
              <MagnifyingGlass size={14} className="t3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search providers"
                aria-label="Search providers"
              />
            </label>
          </div>
          {rows.length ? (
            rows.map(([k, n, h]) => (
              <button type="button" className="hx-pick" key={k}>
                <ProviderIcon kind={k} />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="sm">{n}</span>
                  {h ? <span className="hx-pickhint">{h}</span> : null}
                </span>
                <CaretRight size={14} className="t3" />
              </button>
            ))
          ) : (
            <div className="hx-empty-line" style={{ padding: "8px 16px" }}>
              No provider matches this search.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function ProvidersPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="col" style={{ gap: 32 }}>
      <div className="hx-pvlist">
        <div className="hx-pvrow">
          <ProviderIcon kind="agenta" />
          <span className="hx-pvname">Agenta</span>
          <Tag>Built-in</Tag>
          <span className="grow" />
          <button type="button" className="btn hx-compact">
            Edit
          </button>
        </div>
        {PROJECT_GROUPS.map(([g, rows]) => (
          <div key={g}>
            <div className="hx-pvgroup">{g}</div>
            {rows.map((r) => (
              <div className="hx-pvrow" key={r.name}>
                <ProviderIcon kind={r.kind} />
                <span className="hx-pvname">{r.name}</span>
                <span className="grow" />
                <button type="button" className="btn hx-compact">
                  Edit
                </button>
                <RowMenu />
              </div>
            ))}
          </div>
        ))}
        <div className="hx-pvfoot">
          <button
            type="button"
            className="btn primary hx-pvadd"
            onClick={() => setAdding(true)}
          >
            <Plus size={14} />
            Add a provider or subscription
          </button>
        </div>
      </div>
      <div className="col" style={{ gap: 12 }}>
        <div className="row g8">
          <span className="cps-t">{WORKSPACE.name} organization</span>
          <span className="t3 sm">{ORG_ROWS.length}</span>
        </div>
        <div className="hx-catgrid">
          {ORG_ROWS.map((r) => (
            <div className="hx-catrow" key={r.name}>
              <span className="hx-cattile">
                <ProviderIcon kind={r.kind} size={18} />
              </span>
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="hx-catname">{r.name}</span>
                <span className="hx-catsub cut">{r.sub}</span>
              </span>
              <RowMenu />
            </div>
          ))}
          {[
            ["openai", "ChatGPT", "Sign in with your account"],
            ["anthropic", "Claude", "Paste a token from Claude Code"],
          ].map(([k, n, h]) => (
            <div className="hx-catrow" key={n}>
              <span className="hx-cattile">
                <ProviderIcon kind={k} size={18} />
              </span>
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="hx-catname">{n}</span>
                <span className="hx-catsub cut">{h}</span>
              </span>
              <Ib label={`Connect ${n}`}>
                <Plus size={15} />
              </Ib>
            </div>
          ))}
        </div>
      </div>
      {adding ? <AddProvider onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- model picker */

const MODEL_GROUPS = [
  {
    key: "agenta",
    label: "Agenta",
    tag: "Built-in",
    models: [
      ["Claude Sonnet 5.5", "claude-sonnet-5-5"],
      ["GPT-5.5 mini", "gpt-5.5-mini"],
    ],
  },
  {
    key: "openai",
    label: "OpenAI",
    tag: "Organization",
    via: "Pi",
    models: [
      ["GPT-5.5", "gpt-5.5"],
      ["GPT-5.5 mini", "gpt-5.5-mini"],
    ],
  },
  {
    key: "anthropic",
    label: "Claude",
    tag: "Subscription",
    via: "Claude Code",
    models: [
      ["Claude Opus 5.5", "opus[1m]"],
      ["Claude Sonnet 5.5", "claude-sonnet-5-5"],
    ],
  },
];

/** ModelPickerList in a popover: search, groups with the provider logo, rows, the footer. */
export function ModelPicker({
  value,
  onPick,
  trigger,
  align = "right",
  up = false,
}) {
  const [q, setQ] = useState("");
  return (
    <Pop
      align={align}
      trigger={trigger}
      menuClass={cx("hx-modelmenu", up && "up")}
    >
      {(close) => (
        <>
          <label className="hx-search hx-msearch">
            <MagnifyingGlass size={14} className="t3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models"
              aria-label="Search models"
            />
            <span className="mono t3" style={{ fontSize: 11 }}>
              /model
            </span>
          </label>
          <div className="hx-mscroll">
            {MODEL_GROUPS.map((g) => {
              const rows = g.models.filter(([l, id]) =>
                (l + id).toLowerCase().includes(q.toLowerCase()),
              );
              if (!rows.length) return null;
              return (
                <div key={g.key}>
                  <div className="hx-mghead">
                    <ProviderIcon kind={g.key} size={14} />
                    <span className="b5" style={{ color: "var(--colorText)" }}>
                      {g.label}
                    </span>
                    <Tag tone={g.tag === "Subscription" ? "olive" : undefined}>
                      {g.tag}
                    </Tag>
                    <span className="grow" />
                    {g.via ? <span>via {g.via}</span> : null}
                  </div>
                  {rows.map(([l, id]) => (
                    <button
                      type="button"
                      key={g.key + id}
                      className={cx("hx-mrow", value === id && "on")}
                      onClick={() => {
                        onPick?.({
                          label: l,
                          id,
                          provider:
                            g.key === "agenta"
                              ? id.startsWith("gpt")
                                ? "openai"
                                : "anthropic"
                              : g.key,
                        });
                        close();
                      }}
                    >
                      <span className="sm grow cut">{l}</span>
                      {id !== l ? (
                        <span className="mono t3" style={{ fontSize: 11 }}>
                          {id}
                        </span>
                      ) : null}
                      {value === id ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="hx-mfoot">
            <button
              type="button"
              className="btn"
              style={{ width: "100%", justifyContent: "center", height: 32 }}
              onClick={close}
            >
              <FadersHorizontal size={14} />
              Manage model providers
            </button>
          </div>
        </>
      )}
    </Pop>
  );
}

/** ComposerModelButton: the provider logo, the model, a caret. */
export const ComposerModel = ({
  initial = { label: "opus[1m]", id: "opus[1m]", provider: "anthropic" },
}) => {
  const [m, setM] = useState(initial);
  return (
    <ModelPicker
      value={m.id}
      up
      onPick={(x) => setM({ label: x.id, id: x.id, provider: x.provider })}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          className={cx("hx-modelbtn", open && "open")}
          onClick={toggle}
          aria-label={`Model: ${m.label}`}
        >
          <ProviderIcon kind={m.provider} size={14} />
          <span className="cut">{m.label}</span>
          <CaretDown size={12} className="t3" />
        </button>
      )}
    />
  );
};

/* ---------------------------------------------------------------- integrations */

const APPS = [
  ["zendesk", "Zendesk", "Customer service and ticketing", "Support", true],
  [
    "google_search_console",
    "Google Search Console",
    "Search traffic, queries and indexing",
    "Marketing",
    true,
  ],
  ["notion", "Notion", "Pages, databases and notes", "Productivity", true],
  ["hubspot", "HubSpot", "CRM, contacts and deals", "Sales", true],
  ["slack", "Slack", "Messages and channels", "Communication", false],
  ["gmail", "Gmail", "Read, send and label email", "Communication", false],
  [
    "googlecalendar",
    "Google Calendar",
    "Events and availability",
    "Productivity",
    false,
  ],
  ["linear", "Linear", "Issues and projects", "Engineering", false],
  ["github", "GitHub", "Issues, pull requests and code", "Engineering", false],
  ["jira", "Jira", "Issues and sprints", "Engineering", false],
  ["intercom", "Intercom", "Conversations with customers", "Support", false],
  [
    "salesforce",
    "Salesforce",
    "Accounts, leads and opportunities",
    "Sales",
    false,
  ],
];
const CATS = [
  "All",
  "Communication",
  "Engineering",
  "Marketing",
  "Productivity",
  "Sales",
  "Support",
];

export function IntegrationsPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [connected, setConnected] = useState(() =>
    Object.fromEntries(APPS.map((x) => [x[0], x[4]])),
  );
  const match = (x) =>
    (cat === "All" || x[3] === cat) &&
    (x[1] + x[2]).toLowerCase().includes(q.toLowerCase());
  const on = APPS.filter((x) => connected[x[0]] && match(x));
  const all = APPS.filter(match);
  const Row = ([slug, name, desc]) => (
    <div className="hx-catrow" key={slug}>
      <span className="hx-cattile">
        <AppLogo slug={slug} name={name} size={18} />
      </span>
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="hx-catname" style={{ fontSize: 13 }}>
          {name}
        </span>
        <span className="hx-catsub cut" style={{ fontSize: 12 }}>
          {desc}
        </span>
      </span>
      {connected[slug] ? (
        <RowMenu />
      ) : (
        <Ib
          label={`Connect ${name}`}
          onClick={() => setConnected((c) => ({ ...c, [slug]: true }))}
        >
          <Plus size={16} />
        </Ib>
      )}
    </div>
  );
  return (
    <div className="col" style={{ gap: 16 }}>
      <label className="hx-search" style={{ width: 340 }}>
        <MagnifyingGlass size={14} className="t3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search integrations"
          aria-label="Search integrations"
        />
      </label>
      <div className="row g6" style={{ flexWrap: "wrap" }}>
        {CATS.map((c) => (
          <button
            type="button"
            key={c}
            className={cx("hx-catchip", cat === c && "on")}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {on.length ? (
        <div className="col" style={{ gap: 12 }}>
          <span className="hx-subhead">
            Connected <span className="tnum">{on.length}</span>
          </span>
          <div className="hx-catgrid">{on.map(Row)}</div>
        </div>
      ) : null}
      <div className="col" style={{ gap: 12, marginTop: 20 }}>
        <span className="hx-subhead">
          All apps <span className="tnum">{all.length}</span>
        </span>
        {all.length ? (
          <div className="hx-catgrid">{all.map(Row)}</div>
        ) : (
          <div className="hx-empty-line">
            No apps match “{q}”. Try another name, or look in all categories.
          </div>
        )}
      </div>
    </div>
  );
}
