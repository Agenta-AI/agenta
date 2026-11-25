import { useRef, useState } from "react";
import {
  Cpu,
  FileText,
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
  Plus,
  PencilSimple,
  CaretRight,
  CaretLeft,
  Code,
  ChatCircleText,
  ClockCounterClockwise,
  SlidersHorizontal,
  ListBullets,
  CaretDown,
  ChartBar,
  Check,
  Lightning,
  MagnifyingGlass,
  Funnel,
  ArrowSquareOut,
  Copy,
  Users,
} from "./ph.jsx";
import { BuilderIcon } from "./icons.jsx";
import { platformLogo } from "./logos.jsx";
import {
  AGENTS,
  DAYS,
  FAILURES,
  RANGES,
  SERIES,
  SKILLS,
  WORKSPACE,
  sessionsOf,
} from "./data.js";
import { AppLogo, Bullet, Ib, Mi, Pop, Switch, cx } from "./Common.jsx";
import { PolicySelect } from "./Panes.jsx";

/** AgentPagesHeader: 48px bar, the title, the page's controls, a divider and the Builder button. */
export function PageHeader({ a, s, title, children }) {
  return (
    <div className="hx-aph">
      <h1>{title}</h1>
      <span className="grow" />
      {children}
      <span className="vsep" />
      <Ib
        label="Builder"
        on={s.panel === "builder"}
        onClick={a.builder}
        className="hx-ib32"
      >
        <BuilderIcon size={16} />
      </Ib>
    </div>
  );
}

export function AgentPage({ a, s, agent }) {
  if (s.view === "channels")
    return (
      <>
        <PageHeader a={a} s={s} title="Channels" />
        <div className="hx-scroll">
          <ChannelsPage agent={agent} />
        </div>
      </>
    );
  if (s.view === "analytics")
    return (
      <>
        <PageHeader a={a} s={s} title="Analytics" />
        <div className="hx-scroll">
          <div className="pain">
            <AnalyticsView agent={agent} />
          </div>
        </div>
      </>
    );
  if (s.view === "sessions")
    return (
      <>
        <PageHeader a={a} s={s} title="Sessions" />
        <div className="hx-scroll">
          <AgentSessions a={a} agent={agent} />
        </div>
      </>
    );
  return <ConfigurationPage a={a} s={s} agent={agent} />;
}

/* ---------------------------------------------------------------- configuration */

const Tri = () => <span className="caret r" />;

function Section({ id, title, action, children, refs }) {
  return (
    <div
      className="cps"
      id={`hx-sec-${id}`}
      ref={(el) => (refs.current[id] = el)}
    >
      <div className="cps-h">
        <span className="cps-t">{title}</span>
        <span className="grow" />
        {action ? (
          <button type="button" className="btn hx-compact">
            {action === "Add" ? (
              <Plus size={14} />
            ) : action === "Edit" ? (
              <PencilSimple size={14} />
            ) : null}
            {action}
          </button>
        ) : null}
      </div>
      <div className="cpc">{children}</div>
    </div>
  );
}

const Prow = ({ icon, name, sub, mono, right, onClick, tile = true }) => (
  <div
    className={cx("cpr", onClick && "hx-click")}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
  >
    {tile ? <span className="cpl t2">{icon}</span> : icon}
    <div className="col grow" style={{ minWidth: 0 }}>
      <span
        className={cx("cut", mono && "mono13")}
        style={mono ? undefined : { fontSize: 14 }}
      >
        {name}
      </span>
      {sub ? <span className="xs t2 cut">{sub}</span> : null}
    </div>
    {right ?? <Tri />}
  </div>
);

const NAV = [
  ["model", "Model"],
  ["instructions", "Instructions"],
  ["integrations", "Integrations"],
  ["subagents", "Subagents"],
  ["mcp", "MCP servers"],
  ["skills", "Skills"],
  ["secrets", "Secrets"],
  ["permissions", "Permissions"],
  ["advanced", "Advanced"],
];

export function ConfigurationPage({ a, s, agent }) {
  const scroller = useRef(null);
  const refs = useRef({});
  const [cur, setCur] = useState("model");
  const [mdOpen, setMdOpen] = useState(false);
  const [policy, setPolicy] = useState(agent.permission);
  const [access, setAccess] = useState("Shared with project");
  const tab = s.cfgTab;
  const go = (id) => {
    setCur(id);
    const el = refs.current[id];
    const box = scroller.current;
    if (el && box) box.scrollTo({ top: el.offsetTop - 28, behavior: "smooth" });
  };
  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    let best = "model";
    for (const [id] of NAV) {
      const el = refs.current[id];
      if (el && el.offsetTop - 40 <= box.scrollTop) best = id;
    }
    if (best !== cur) setCur(best);
  };
  return (
    <>
      <PageHeader a={a} s={s} title="Configuration">
        <span className="hx-revstat">
          <span className="hx-dot ok" />
          {agent.version} · {agent.savedAgo}
        </span>
      </PageHeader>
      <div className="hx-tabstrip">
        <div className="cpw ltabs hx-ltabs">
          {[
            ["agent", "Agent"],
            ["automations", "Automations"],
            ["access", "Access"],
          ].map(([k, l]) => (
            <button
              type="button"
              key={k}
              className={cx(tab === k && "on")}
              onClick={() => a.set({ cfgTab: k })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="hx-scroll hx-raised" ref={scroller} onScroll={onScroll}>
        {tab === "agent" ? (
          <div className="cpw">
            <div className="cpg">
              <nav className="cpn" aria-label="Sections">
                {NAV.map(([id, l]) => (
                  <a
                    key={id}
                    className={cx(cur === id && "on")}
                    onClick={() => go(id)}
                    role="button"
                    tabIndex={0}
                  >
                    {l}
                  </a>
                ))}
              </nav>
              <div className="col" style={{ gap: 28, minWidth: 0 }}>
                <Section id="model" title="Model" action="Change" refs={refs}>
                  <Prow
                    icon={<Cpu size={16} />}
                    name={agent.model.name}
                    sub={`${agent.model.id} · via ${agent.model.harness}`}
                  />
                </Section>
                <Section
                  id="instructions"
                  title="Instructions"
                  action="Edit"
                  refs={refs}
                >
                  <Prow
                    icon={<FileText size={16} />}
                    name="AGENTS.md"
                    mono
                    sub={`${agent.instructions.words} words`}
                    onClick={() => setMdOpen(!mdOpen)}
                    right={
                      <CaretDown
                        size={12}
                        className={cx("t3 hx-rot", mdOpen && "on")}
                      />
                    }
                  />
                  {mdOpen ? (
                    <div className="cpmd hx-mdtop">
                      {(agent.instructions.md.length
                        ? agent.instructions.md
                        : [["", agent.instructions.text]]
                      ).map(([h, p]) => (
                        <div key={h + p}>
                          {h ? <h4>## {h}</h4> : null}
                          <p>{p}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Section>
                <Section
                  id="integrations"
                  title="Integrations"
                  action="Add"
                  refs={refs}
                >
                  {agent.integrations.length ? (
                    agent.integrations.map((x) => (
                      <Prow
                        key={x.name}
                        icon={<AppLogo slug={x.mark} name={x.name} size={20} />}
                        name={x.name}
                        sub={x.sub}
                      />
                    ))
                  ) : (
                    <div className="cpe">No integrations yet</div>
                  )}
                </Section>
                <Section
                  id="subagents"
                  title="Subagents"
                  action="Add"
                  refs={refs}
                >
                  <div className="cpe">No subagents yet</div>
                </Section>
                <Section id="mcp" title="MCP servers" action="Add" refs={refs}>
                  <div className="cpe">No MCP servers yet</div>
                </Section>
                <Section id="skills" title="Skills" action="Add" refs={refs}>
                  {agent.skills.length ? (
                    agent.skills.map((id) => {
                      const sk = SKILLS.find((x) => x.id === id);
                      return (
                        <Prow
                          key={id}
                          icon={<Compass size={16} />}
                          name={sk.title}
                          mono
                          sub={sk.desc}
                          onClick={() =>
                            a.set({
                              page: "skills",
                              rail: "main",
                              panel: null,
                              skill: id,
                            })
                          }
                        />
                      );
                    })
                  ) : (
                    <div className="cpe">No skills yet</div>
                  )}
                </Section>
                <Section id="secrets" title="Secrets" action="Add" refs={refs}>
                  {agent.secrets.length ? (
                    agent.secrets.map((x) => (
                      <Prow
                        key={x.name}
                        icon={<LockSimple size={16} />}
                        name={x.name}
                        mono
                        sub={x.sub}
                      />
                    ))
                  ) : (
                    <div className="cpe">No custom secrets attached.</div>
                  )}
                </Section>
                <Section id="permissions" title="Permissions" refs={refs}>
                  <Prow
                    icon={<Shield size={16} />}
                    name="Policy"
                    sub="What the agent may do without asking"
                    right={<PolicySelect value={policy} onChange={setPolicy} />}
                  />
                </Section>
                <Section id="advanced" title="Advanced" refs={refs}>
                  <Prow
                    icon={<Cube size={16} />}
                    name="Execution"
                    sub="Daytona sandbox"
                  />
                  <Prow
                    icon={<Toolbox size={16} />}
                    name="Agenta tools"
                    sub="Files, sessions and memory"
                  />
                  <Prow
                    icon={<Hammer size={16} />}
                    name="Build kit"
                    sub="The tools the builder uses"
                  />
                </Section>
              </div>
            </div>
          </div>
        ) : tab === "automations" ? (
          <div className="hx-col760">
            <div className="cps">
              <div className="cps-h">
                <span className="cps-t">Automations</span>
                <span className="grow" />
                <Pop
                  align="right"
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      className="btn hx-compact"
                      onClick={toggle}
                    >
                      <Plus size={14} />
                      Add automation
                    </button>
                  )}
                  menuClass="hx-w280"
                >
                  {(close) => (
                    <>
                      <Mi onClick={close} icon={<PencilSimple size={16} />}>
                        Create manually
                      </Mi>
                      <Mi onClick={close} icon={<Lightning size={16} />}>
                        Run on a schedule or an event
                      </Mi>
                    </>
                  )}
                </Pop>
              </div>
              {[
                [
                  "Scheduled triggers",
                  agent.automations.scheduled,
                  ClockCounterClockwise,
                ],
                ["App triggers", agent.automations.app, Lightning],
              ].map(([g, list, I]) => (
                <div key={g} className="col g8">
                  <span className="hx-grouphead">{g}</span>
                  <div className="cpc">
                    {list.length ? (
                      list.map((x) => (
                        <Prow
                          key={x.name}
                          icon={<I size={16} />}
                          name={x.name}
                          sub={x.when}
                          right={<span className="hx-pill on">On</span>}
                        />
                      ))
                    ) : (
                      <div className="cpe">None yet</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="hx-col760">
            <div className="cps">
              <span className="cps-t">Who can see this agent</span>
              <div className="hx-two">
                {[
                  [
                    "Private",
                    LockSimple,
                    "Only you can see and use it in Agenta.",
                  ],
                  [
                    "Shared with project",
                    Users,
                    `Everyone in ${WORKSPACE.name} can see and use it.`,
                  ],
                ].map(([k, I, d]) => (
                  <button
                    type="button"
                    key={k}
                    className={cx("radio", access === k && "on")}
                    onClick={() => setAccess(k)}
                  >
                    <span className="rd" />
                    <span className="col g4">
                      <span className="row g6 b5 sm">
                        <I size={14} />
                        {k}
                      </span>
                      <span className="xs t2">{d}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="cps" style={{ marginTop: 28 }}>
              <span className="cps-t">Owner</span>
              <div className="cpc">
                <div className="cpr">
                  <span className="hx-avatar" style={{ width: 28, height: 28 }}>
                    {agent.owner === "You"
                      ? WORKSPACE.user.initials
                      : agent.owner
                          .split(" ")
                          .map((w) => w[0])
                          .join("")}
                  </span>
                  <div className="col grow">
                    <span style={{ fontSize: 14 }}>
                      {agent.owner === "You"
                        ? `${WORKSPACE.user.name} (you)`
                        : agent.owner}
                    </span>
                  </div>
                  <button type="button" className="btn hx-compact">
                    Transfer ownership
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- channels */

const CHANNELS = [
  ["slack", "Slack", "Chat with the agent in your team’s workspace"],
  ["telegram", "Telegram", "Chat with the agent from your phone"],
  ["whatsapp", "WhatsApp", "Answer messages to your WhatsApp Business number"],
  ["discord", "Discord", "Chat with the agent in your Discord server"],
  ["teams", "Microsoft Teams", "Chat with the agent in Microsoft Teams"],
];

// Workspace connections that answer as another agent (Slack answers as Support triage).
const otherConnection = (agent, key) => {
  const other = AGENTS.find(
    (x) => x.id !== agent.id && x.channels[key] === "connected",
  );
  return other ? `Connected to ${other.name}` : null;
};

export function ChannelList({
  agent,
  compact,
  connected = {},
  onOpen = () => {},
}) {
  const isOn = (k) => connected[k] ?? agent.channels[k] === "connected";
  const on = CHANNELS.filter(([k]) => isOn(k));
  const off = CHANNELS.filter(([k]) => !isOn(k));
  const Card = ([k, label, sub]) => {
    const conn = isOn(k);
    const other = !conn && otherConnection(agent, k);
    const body = (
      <>
        <span className="hx-chlogo">{platformLogo(k, compact ? 22 : 32)}</span>
        <span className="col grow" style={{ minWidth: 0 }}>
          <span className="b5">{label}</span>
          <span className={cx("hx-chsub cut", !conn && "t3")}>
            {conn
              ? k === "slack"
                ? `${WORKSPACE.name} workspace`
                : `@${agent.name.toLowerCase().replace(/\s+/g, "-")}`
              : other || sub}
          </span>
        </span>
      </>
    );
    if (conn)
      return (
        <button
          type="button"
          className="hx-ch hx-click"
          key={k}
          onClick={() => onOpen(k)}
        >
          {body}
          <span className="sm t2">Manage</span>
          <CaretRight size={10} weight="fill" className="hx-chcaret" />
        </button>
      );
    return (
      <div className="hx-ch" key={k}>
        {body}
        <button
          type="button"
          className="btn hx-compact"
          onClick={() => onOpen(k)}
        >
          {other ? "Connect here" : "Connect"}
        </button>
      </div>
    );
  };
  return (
    <div className="col" style={{ gap: 20 }}>
      <p className="hx-chintro">
        A channel lets people talk to {agent.name} in the chat app they already
        use.
      </p>
      {on.length ? (
        <div className="col g8">
          <span className="hx-grouphead">Connected</span>
          {on.map(Card)}
        </div>
      ) : null}
      <div className="col g8">
        <span className="hx-grouphead">Add a channel</span>
        {off.map(Card)}
        {[
          ["api", "API", "Always on for saved versions", Code],
          ["embed", "Embed", "A chat on your website", ChatCircleText],
        ].map(([k, l, sub, I]) => (
          <button
            type="button"
            className="hx-ch hx-click"
            key={k}
            onClick={() => onOpen(k)}
          >
            <span className="hx-chmark">
              <I size={16} weight={k === "api" ? "bold" : "regular"} />
            </span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="b5">{l}</span>
              <span className="hx-chsub cut t3">{sub}</span>
            </span>
            <CaretRight size={10} weight="fill" className="hx-chcaret" />
          </button>
        ))}
      </div>
    </div>
  );
}

const CODE = {
  Python:
    'import requests\n\nresponse = requests.post(\n    "https://cloud.agenta.ai/api/agents/run",\n    headers={"Authorization": "ApiKey $AGENTA_API_KEY"},\n    json={"agent": "seo-content-agent", "message": "Write a brief for agency pricing"},\n)\nprint(response.json()["output"])',
  TypeScript:
    'const response = await fetch("https://cloud.agenta.ai/api/agents/run", {\n  method: "POST",\n  headers: { Authorization: `ApiKey ${process.env.AGENTA_API_KEY}` },\n  body: JSON.stringify({ agent: "seo-content-agent", message: "Write a brief for agency pricing" }),\n});\nconsole.log((await response.json()).output);',
  cURL: 'curl https://cloud.agenta.ai/api/agents/run \\\n  -H "Authorization: ApiKey $AGENTA_API_KEY" \\\n  -d \'{"agent": "seo-content-agent", "message": "Write a brief for agency pricing"}\'',
};

function Flow({ k, agent, onDone }) {
  const [opt, setOpt] = useState(0);
  const [lang, setLang] = useState("Python");
  const [stream, setStream] = useState(false);
  const [key, setKey] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [theme, setTheme] = useState("Light");
  const handle = agent.name.toLowerCase().replace(/\s+/g, "-");
  if (k === "api")
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="col g6">
          <span className="hx-flabel">Endpoint</span>
          <div className="field mono13">
            <span className="cut grow">
              https://cloud.agenta.ai/api/agents/run
            </span>
            <Copy size={14} className="t3" />
          </div>
        </div>
        <div className="col g6">
          <span className="hx-flabel">API key</span>
          <div className="row g8">
            <div className="field mono13 grow">
              {key ? "ag-Qe4r…7mZp" : <span className="t3">No key yet</span>}
            </div>
            <button type="button" className="btn" onClick={() => setKey(true)}>
              {key ? (
                <>
                  <Check size={14} />
                  Created
                </>
              ) : (
                "Create API key"
              )}
            </button>
          </div>
        </div>
        <div className="hx-code">
          <div className="hx-codebar">
            {Object.keys(CODE).map((l) => (
              <button
                type="button"
                key={l}
                className={cx(lang === l && "on")}
                onClick={() => setLang(l)}
              >
                {l}
              </button>
            ))}
            <span className="grow" />
            <span className="xs t2 row g6">
              <Switch on={stream} onChange={setStream} label="Streaming" />
              Streaming
            </span>
          </div>
          <pre>{CODE[lang]}</pre>
          <div className="hx-codefoot xs t2">
            {stream ? "Streaming response" : "JSON response"}
          </div>
        </div>
        <a className="hx-link sm" href="#" onClick={(e) => e.preventDefault()}>
          Read the docs <ArrowSquareOut size={12} />
        </a>
      </div>
    );
  if (k === "embed")
    return embed ? (
      <div className="col" style={{ gap: 16 }}>
        <div className="col g6">
          <span className="hx-flabel">Theme</span>
          <span className="seg">
            {["Light", "Dark"].map((t) => (
              <button
                type="button"
                key={t}
                className={cx(theme === t && "on")}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </span>
        </div>
        <div className="col g6">
          <span className="hx-flabel">Greeting</span>
          <input
            className="field"
            defaultValue={`Hi! I am the ${agent.name}. How can I help?`}
          />
        </div>
        <div className="col g6">
          <span className="hx-flabel">Starter prompts</span>
          <input className="field" defaultValue="Write a brief for a keyword" />
        </div>
        <div className="col g6">
          <span className="hx-flabel">Add to your website</span>
          <div className="hx-code">
            <pre>{`<script src="https://cloud.agenta.ai/embed.js"\n  data-agent="${handle}" data-theme="${theme.toLowerCase()}" defer></script>`}</pre>
          </div>
        </div>
      </div>
    ) : (
      <div className="col" style={{ gap: 16 }}>
        <p className="sm t2">Add a chat with this agent to your website.</p>
        <div className="hx-emptybox">
          <span className="hx-emptyic">
            <ChatCircleText size={16} />
          </span>
          <span className="sm t2">No embeds yet</span>
          <button
            type="button"
            className="btn primary"
            onClick={() => setEmbed(true)}
          >
            <Plus size={14} />
            Create embed
          </button>
        </div>
      </div>
    );
  if (k === "slack")
    return (
      <div className="col" style={{ gap: 16 }}>
        <span className="hx-flabel">Connect with</span>
        {[
          ["Agenta app", `One click. Shows up as @${handle}.`],
          ["Existing app", "Reuse an app you already created in Slack."],
          ["New app", `Start from a manifest we fill in for ${agent.name}.`],
        ].map(([t, d], i) => (
          <button
            type="button"
            key={t}
            className={cx("radio", opt === i && "on")}
            onClick={() => setOpt(i)}
          >
            <span className="rd" />
            <span className="col">
              <span className="b5 sm">{t}</span>
              <span className="xs t2">{d}</span>
            </span>
          </button>
        ))}
        <div className="col g8 hx-facts">
          <span className="sm">
            <b className="b5">Replies in threads.</b>{" "}
            <span className="t2">
              Mention @{handle} in a channel to get an answer from {agent.name}.
            </span>
          </span>
          <span className="sm">
            <b className="b5">Reads only where it’s added.</b>{" "}
            <span className="t2">Channels you invite it to, plus DMs.</span>
          </span>
          <span className="sm">
            <b className="b5">Nothing to maintain.</b>{" "}
            <span className="t2">
              No manifest or secrets. Disconnect any time.
            </span>
          </span>
        </div>
        <button
          type="button"
          className="btn primary"
          style={{ alignSelf: "flex-start" }}
          onClick={onDone}
        >
          Add to Slack
        </button>
      </div>
    );
  if (k === "telegram")
    return (
      <div className="col" style={{ gap: 16 }}>
        {[
          ["Agenta bot", "Scan a code and start chatting."],
          ["Your own app", "Your name and avatar. About 5 min."],
        ].map(([t, d], i) => (
          <button
            type="button"
            key={t}
            className={cx("radio", opt === i && "on")}
            onClick={() => setOpt(i)}
          >
            <span className="rd" />
            <span className="col">
              <span className="b5 sm">{t}</span>
              <span className="xs t2">{d}</span>
            </span>
          </button>
        ))}
        {opt === 0 ? (
          <div className="row g12">
            <Qr />
            <div className="col g8">
              <span className="sm t2">
                Scan the code with your phone, or open the link on this
                computer.
              </span>
              <button
                type="button"
                className="btn primary"
                style={{ alignSelf: "flex-start" }}
                onClick={onDone}
              >
                Open in Telegram
              </button>
            </div>
          </div>
        ) : (
          <div className="col g8">
            <span className="b5 sm">Create a bot with @BotFather</span>
            <span className="sm t2">
              Send /newbot, then pick a name and a username ending in “bot”.
            </span>
            <button
              type="button"
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
              onClick={onDone}
            >
              Connect bot
            </button>
          </div>
        )}
      </div>
    );
  const steps =
    k === "whatsapp"
      ? [
          [
            "Create a Meta app with WhatsApp",
            "In Meta’s App Dashboard, create a Business app and add the WhatsApp product.",
          ],
          [
            "Copy three values",
            "The phone number ID, a permanent token for a system user, and the app secret.",
          ],
        ]
      : k === "discord"
        ? [
            [
              "Create a bot in Discord",
              "In the Developer Portal, create an application. On its Bot page, reset the token and copy it.",
            ],
            [
              "Turn on Message Content Intent",
              "It is on the same Bot page. Without it, the bot cannot read messages.",
            ],
          ]
        : [["Your own app", "Your name and avatar. About 5 min."]];
  return (
    <div className="col" style={{ gap: 16 }}>
      {steps.map(([t, d], i) => (
        <div className="row g12" key={t} style={{ alignItems: "flex-start" }}>
          <span className="hx-step">{i + 1}</span>
          <span className="col g4">
            <span className="b5 sm">{t}</span>
            <span className="sm t2">{d}</span>
          </span>
        </div>
      ))}
      <button
        type="button"
        className="btn primary"
        style={{ alignSelf: "flex-start" }}
        onClick={onDone}
      >
        {k === "whatsapp"
          ? "Connect to WhatsApp"
          : k === "discord"
            ? "Connect bot"
            : "Connect app"}
      </button>
    </div>
  );
}

const Qr = () => {
  const cells = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280), seed / 233280);
  for (let i = 0; i < 441; i++) {
    const x = i % 21,
      y = Math.floor(i / 21);
    const f = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    const lx = x < 7 ? x : x - 14,
      ly = y < 7 ? y : y - 14;
    const on = f
      ? lx === 0 ||
        ly === 0 ||
        lx === 6 ||
        ly === 6 ||
        (lx > 1 && lx < 5 && ly > 1 && ly < 5)
      : rnd() > 0.52;
    if (on) cells.push(<rect key={i} x={x} y={y} width="1" height="1" />);
  }
  return (
    <svg
      width="104"
      height="104"
      viewBox="-1 -1 23 23"
      className="hx-qr"
      aria-hidden="true"
    >
      {cells}
    </svg>
  );
};

export function ChannelsPage({ agent }) {
  const [open, setOpen] = useState(null);
  const [connected, setConnected] = useState({});
  const meta = [...CHANNELS, ["api", "API"], ["embed", "Embed"]].find(
    ([k]) => k === open,
  );
  return (
    <div className="hx-col760" style={{ paddingTop: 16 }}>
      {open ? (
        <div className="col" style={{ gap: 20 }}>
          <div className="row g6 hx-crumbs">
            <Ib label="Back" onClick={() => setOpen(null)}>
              <CaretLeft size={16} />
            </Ib>
            <button
              type="button"
              className="crumb2"
              onClick={() => setOpen(null)}
            >
              Channels
            </button>
            <CaretRight size={12} className="t3" />
            <span className="row g6 b5 sm">
              {["api", "embed"].includes(open) ? (
                open === "api" ? (
                  <Code size={14} weight="bold" />
                ) : (
                  <ChatCircleText size={14} />
                )
              ) : (
                platformLogo(open, 16)
              )}
              {meta[1]}
            </span>
          </div>
          <Flow
            k={open}
            agent={agent}
            onDone={() => {
              setConnected((c) => ({ ...c, [open]: true }));
              setOpen(null);
            }}
          />
        </div>
      ) : (
        <ChannelList agent={agent} connected={connected} onOpen={setOpen} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- analytics */

const COLORS = {
  cost: "#7e90a4",
  runs: "#b5b16c",
  success: "#88ad94",
  failedBar: "#ecc3c0",
  input: "#7e90a4",
  output: "#d2a08a",
  cacheRead: "#b5b16c",
  cacheWrite: "#88b0ad",
};
const LABELS = {
  "Last 24 hours": [
    "00:00",
    "04:00",
    "08:00",
    "12:00",
    "16:00",
    "20:00",
    "23:00",
  ],
  "Last 7 days": DAYS,
  "Last 30 days": [
    "Oct 27",
    "Oct 31",
    "Nov 4",
    "Nov 8",
    "Nov 12",
    "Nov 16",
    "Nov 20",
  ],
  "Last 90 days": [
    "Aug 27",
    "Sep 11",
    "Sep 26",
    "Oct 11",
    "Oct 26",
    "Nov 10",
    "Nov 25",
  ],
};

function Card({ title, value, caption, children, legend }) {
  return (
    <div className="pacard">
      <div className="row">
        <span className="hx-cardt">{title}</span>
        <span className="grow" />
        <button type="button" className="paexp">
          Explore
          <CaretRight size={12} />
        </button>
      </div>
      <div className="row g8 hx-headline">
        <span className="hx-val">{value}</span>
        <span className="xs t2">{caption}</span>
      </div>
      <div style={{ marginTop: 12 }}>{children}</div>
      {legend}
    </div>
  );
}

function Bars({
  ticks,
  height,
  stacks,
  colors,
  labels,
  avg,
  avgLabel,
  line,
  lineTicks,
  fails,
}) {
  const max = ticks[0][0];
  const lx = (i, n) => 2 + (96 * (i + 0.5)) / n;
  const ly = (v) =>
    (1 -
      (Math.max(lineTicks[1], v) - lineTicks[1]) /
        (lineTicks[0] - lineTicks[1])) *
    100;
  return (
    <>
      <div className="pachart" style={{ height }}>
        <div className="pay">
          {ticks.map(([, l]) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <div className="paplot">
          {ticks.map(([v], i) => (
            <div
              className="pagl"
              key={i}
              style={{
                top: `${((max - v) / (max - ticks[ticks.length - 1][0])) * 100}%`,
              }}
            />
          ))}
          {stacks ? (
            <div className="pabars">
              {stacks.map((st, i) => (
                <div
                  className="pabar hx-stack"
                  key={i}
                  style={{
                    height: `${(st.reduce((x, y) => x + y, 0) / max) * 100}%`,
                  }}
                >
                  {st
                    .map((v, j) =>
                      v ? (
                        <i
                          key={j}
                          style={{ flexGrow: v, background: colors[j] }}
                        />
                      ) : null,
                    )
                    .reverse()}
                </div>
              ))}
            </div>
          ) : null}
          {fails ? (
            <div className="pabars">
              {fails.map((f, i) => (
                <div
                  className="pabar"
                  key={i}
                  style={{
                    height: `${f * 100}%`,
                    background: COLORS.failedBar,
                  }}
                />
              ))}
            </div>
          ) : null}
          {avg != null ? (
            <div className="paavg" style={{ top: `${(1 - avg / max) * 100}%` }}>
              <b>{avgLabel}</b>
            </div>
          ) : null}
          {line ? (
            <svg
              className="hx-line"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline
                fill="none"
                stroke={COLORS.success}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                points={line
                  .map((v, i) => `${lx(i, line.length)},${ly(v)}`)
                  .join(" ")}
              />
            </svg>
          ) : null}
          {line
            ? line.map((v, i) => (
                <i
                  className="hx-ldot"
                  key={i}
                  style={{ left: `${lx(i, line.length)}%`, top: `${ly(v)}%` }}
                />
              ))
            : null}
        </div>
      </div>
      <div className="pax">
        {labels.map((l, i) => (
          <span key={l + i}>{i % 2 === 0 ? l : ""}</span>
        ))}
      </div>
    </>
  );
}

const fmtM = (n) => `${n.toFixed(1)}M`;

export function AnalyticsView({ agent, workspace }) {
  const [range, setRange] = useState("Last 7 days");
  const [group, setGroup] = useState(null);
  const [hidden, setHidden] = useState({});
  const share = agent
    ? ({ support: 0.42, seo: 0.31, lead: 0.18 }[agent.id] ?? 0.09)
    : 1;
  const k = RANGES[range].scale * share;
  const cost = SERIES.cost.map((v) => v * k);
  const runs = SERIES.runs.map((v) => Math.max(1, Math.round(v * k)));
  const failed = SERIES.failed.map((v) =>
    agent && agent.id !== "support" && agent.id !== "lead"
      ? 0
      : Math.round(v * RANGES[range].scale),
  );
  const totalCost = cost.reduce((x, y) => x + y, 0);
  const totalRuns = runs.reduce((x, y) => x + y, 0);
  const totalFailed = failed.reduce((x, y) => x + y, 0);
  const rate = totalRuns ? ((totalRuns - totalFailed) / totalRuns) * 100 : 100;
  const success = runs.map((r, i) => (r ? ((r - failed[i]) / r) * 100 : 100));
  const lo = Math.min(90, Math.floor(Math.min(...success) / 10) * 10);
  const keys = ["input", "output", "cacheRead", "cacheWrite"];
  const tok = DAYS.map((_, i) =>
    keys.map((key) => (hidden[key] ? 0 : SERIES.tokens[key][i] * k)),
  );
  const totalTok = tok.flat().reduce((x, y) => x + y, 0);
  const nice = (m) => {
    const p = 10 ** Math.floor(Math.log10(m));
    const n = [1, 2, 2.5, 5, 10].find((x) => x * p >= m);
    return n * p;
  };
  const costMax = nice(Math.max(...cost) * 1.02);
  const runMax = nice(Math.max(...runs) * 1.02);
  const tokMax = nice(
    Math.max(...tok.map((t) => t.reduce((x, y) => x + y, 0))) * 1.02 || 1,
  );
  const money = (v) => (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(0)}`);
  const unit =
    range === "Last 24 hours"
      ? "hour"
      : range === "Last 7 days"
        ? "day"
        : range === "Last 30 days"
          ? "4 days"
          : "2 weeks";
  const labels = LABELS[range];
  const tokNames = {
    input: "Input",
    output: "Output",
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
  };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row g8" style={{ flexWrap: "wrap" }}>
        {agent ? (
          <span className="pachip">
            <LockSimple size={12} className="t2" />
            {agent.name}
            <span style={{ width: 6 }} />
          </span>
        ) : null}
        <Pop
          trigger={({ toggle }) => (
            <button type="button" className="pabtn" onClick={toggle}>
              <ClockCounterClockwise size={14} />
              {range}
            </button>
          )}
          menuClass="hx-w200"
        >
          {(close) =>
            [...Object.keys(RANGES), "Custom range…"].map((r) => (
              <Mi
                key={r}
                cur={r === range}
                onClick={() => {
                  if (RANGES[r]) setRange(r);
                  close();
                }}
              >
                {r}
              </Mi>
            ))
          }
        </Pop>
        <button type="button" className="pabtn">
          <SlidersHorizontal size={14} />
          Filter
        </button>
        {workspace ? (
          <Pop
            trigger={({ toggle }) => (
              <button type="button" className="pabtn" onClick={toggle}>
                <ListBullets size={14} />
                {group ? `Group: ${group}` : "Group"}
              </button>
            )}
            menuClass="hx-w200"
          >
            {(close) =>
              ["None", "Agent", "Model", "Provider"].map((g) => (
                <Mi
                  key={g}
                  cur={(group ?? "None") === g}
                  onClick={() => {
                    setGroup(g === "None" ? null : g);
                    close();
                  }}
                >
                  {g}
                </Mi>
              ))
            }
          </Pop>
        ) : null}
      </div>
      <Card title="Cost" value={`$${totalCost.toFixed(2)}`} caption={range}>
        <Bars
          height={210}
          ticks={[
            [costMax, money(costMax)],
            [costMax / 2, money(costMax / 2)],
            [0, "$0"],
          ]}
          stacks={cost.map((v) => [v])}
          colors={[COLORS.cost]}
          labels={labels}
          avg={totalCost / 7}
          avgLabel={`avg $${(totalCost / 7).toFixed(0)} / ${unit}`}
        />
      </Card>
      <div className="pagrid">
        <Card title="Runs" value={totalRuns} caption={range}>
          <Bars
            height={150}
            ticks={[
              [runMax, runMax],
              [runMax / 2, runMax / 2],
              [0, 0],
            ]}
            stacks={runs.map((v) => [v])}
            colors={[COLORS.runs]}
            labels={labels}
          />
        </Card>
        <Card
          title="Success rate"
          value={`${rate.toFixed(1)}%`}
          caption={`succeeded · ${totalFailed} failed (${(100 - rate).toFixed(1)}%)`}
          legend={
            <div className="paleg">
              <span>
                <i style={{ background: COLORS.success }} />
                Success rate
              </span>
              <span>
                <i style={{ background: COLORS.failedBar }} />
                Failed runs ({totalFailed})
              </span>
            </div>
          }
        >
          <Bars
            height={150}
            ticks={[
              [100, "100%"],
              [(100 + lo) / 2, `${(100 + lo) / 2}%`],
              [lo, `${lo}%`],
            ]}
            labels={labels}
            line={success}
            lineTicks={[100, lo]}
            fails={failed.map((f) =>
              f ? Math.min(0.5, f / Math.max(...runs)) : 0,
            )}
          />
        </Card>
      </div>
      <Card
        title="Tokens by type"
        value={fmtM(totalTok)}
        caption={range}
        legend={
          <div className="paleg">
            {keys.map((key) => (
              <button
                type="button"
                key={key}
                className={cx("hx-legbtn", hidden[key] && "off")}
                onClick={() => setHidden((h) => ({ ...h, [key]: !h[key] }))}
              >
                <i style={{ background: COLORS[key] }} />
                {tokNames[key]}
              </button>
            ))}
          </div>
        }
      >
        <Bars
          height={150}
          ticks={[
            [tokMax, fmtM(tokMax).replace(".0M", "M")],
            [tokMax / 2, fmtM(tokMax / 2).replace(".0M", "M")],
            [0, "0"],
          ]}
          stacks={tok}
          colors={keys.map((key) => COLORS[key])}
          labels={labels}
        />
      </Card>
      {workspace ? (
        <div className="pacard">
          <span className="hx-cardt">Failures by agent</span>
          <span className="xs t2" style={{ marginTop: 4 }}>
            {range}
          </span>
          {FAILURES.length ? (
            <div style={{ marginTop: 12 }}>
              <div className="pafail pafh">
                <span>Agent</span>
                <span>Main reason</span>
                <span>Failed</span>
                <span>Rate</span>
              </div>
              {FAILURES.map((f) => (
                <div className="pafail pafr" key={f.agent}>
                  <span className="cut">{f.agent}</span>
                  <span className="cut t2">{f.reason}</span>
                  <span>{f.failed}</span>
                  <span>{f.rate}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="hx-chartempty">
              <span className="hx-emptyic">
                <ChartBar size={16} />
              </span>
              <span className="sm t2">No failed runs in the last 7 days</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- agent sessions */

function AgentSessions({ a, agent }) {
  const [q, setQ] = useState("");
  const list = sessionsOf(agent.id).filter((x) =>
    x.title.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="psin">
      <div className="row g8" style={{ marginBottom: 8 }}>
        <label className="psfind">
          <MagnifyingGlass size={14} className="t3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
          />
        </label>
        <button type="button" className="psfbtn" aria-label="Filter">
          <Funnel size={14} />
        </button>
      </div>
      <div className="pshead">
        <span>Session</span>
        <span>Started by</span>
        <span>Last activity</span>
        <span />
      </div>
      {["Today", "Yesterday", "Earlier"].map((d) => {
        const rows = list.filter((x) => x.day === d);
        if (!rows.length) return null;
        return (
          <div key={d}>
            <div className="psgroup">{d}</div>
            {rows.map((x) => (
              <div
                className="psrow"
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => a.openSession(x.id, agent.id)}
              >
                <span className="pscell">
                  <Bullet status={x.status} />
                  <span className="cut">{x.title}</span>
                </span>
                <span className="pscell t2 sm">
                  {x.status === "auto" ? "Automation" : WORKSPACE.user.name}
                </span>
                <span className="t2 sm">
                  {d === "Today"
                    ? "2 h ago"
                    : d === "Yesterday"
                      ? "Yesterday"
                      : "Nov 18"}
                </span>
                <span />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export { CHANNELS };
