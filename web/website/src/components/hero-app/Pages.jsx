import { useState } from "react";
import {
  ArrowUp,
  Paperclip,
  CaretDown,
  Plus,
  MagnifyingGlass,
  Funnel,
  ListBullets,
  SquaresFour,
  DotsThreeVertical,
  DotsThree,
  ArrowRight,
  BookOpen,
  UploadSimple,
  GithubLogo,
  PencilSimple,
  File as FileIcon,
  CaretUpDown,
  Trash,
  Info,
  Archive,
  DownloadSimple,
  X,
  Check,
  Lightning,
  ClockCounterClockwise,
  Compass,
  ClockClockwise,
  Play,
  Pause,
  ArrowLeft,
  CaretRight,
} from "./ph.jsx";
import { BotIcon } from "./icons.jsx";
import { AGENTS, AUTOMATIONS, RUNS, SKILLS, WORKSPACE } from "./data.js";
import { AgentChip, Ib, Mi, Pop, Switch, cx, onPress } from "./Common.jsx";

const TEMPLATES = [
  [
    "Answer customer questions",
    "On the website and in WhatsApp, from your documents.",
    ["#0E7490", "#E2F1F5"],
  ],
  [
    "Reply to new leads",
    "Replies in minutes, qualifies and books a call.",
    ["#7C3AED", "#F1EBFD"],
  ],
  [
    "Weekly client report",
    "Traffic and ad results in a short report per client.",
    ["#CA8A04", "#FBF4DF"],
  ],
  [
    "Draft support replies",
    "Sorts the inbox and drafts replies for approval.",
    ["#113955", "#E5F1F9"],
  ],
  [
    "Social posts in your voice",
    "Plans and writes posts from your blog and news.",
    ["#0F766E", "#E3F2F0"],
  ],
  [
    "Proposals in your format",
    "Drafts a proposal from a brief and your past ones.",
    ["#475569", "#EEF1F5"],
  ],
];

/* ---------------------------------------------------------------- home */

export function HomePage({ a, s }) {
  const [tab, setTab] = useState(s.homeTab ?? "agents");
  const [pick, setPick] = useState(null);
  const [text, setText] = useState("");
  const create = !pick;
  return (
    <div className="hx-scroll">
      <div className="hx-home">
        <div className="hx-greet">
          Good morning, {WORKSPACE.user.name.split(" ")[0]}
        </div>
        <h1 className="hx-h1">What should we work on?</h1>
        <div className="hx-homecomp">
          <div className="composer nccomp" style={{ margin: 0 }}>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                create
                  ? "Describe the agent you want — what it does, when it runs…"
                  : "Describe the task, or start the conversation…"
              }
              aria-label="Message"
            />
            <div className="row g8">
              <Paperclip size={16} className="t3" />
              <span className="grow" />
              <button
                type="button"
                className={cx("send", !text && "off")}
                aria-label="Send"
              >
                <ArrowUp size={14} weight="bold" />
              </button>
            </div>
          </div>
          <div className="hx-dock">
            <Pop
              trigger={({ toggle }) => (
                <button type="button" className="agpill" onClick={toggle}>
                  {pick ? (
                    <AgentChip agent={pick} size={16} radius={4} glyph={10} />
                  ) : (
                    <Plus size={12} />
                  )}
                  {pick ? pick.name : "New agent"}
                  <CaretDown size={10} />
                </button>
              )}
              menuClass="hx-w280"
            >
              {(close) => (
                <>
                  <Mi
                    cur={!pick}
                    icon={<Plus size={16} />}
                    onClick={() => {
                      setPick(null);
                      close();
                    }}
                  >
                    New agent
                  </Mi>
                  <div className="msep" />
                  {AGENTS.map((ag) => (
                    <Mi
                      key={ag.id}
                      cur={pick?.id === ag.id}
                      icon={
                        <AgentChip agent={ag} size={22} radius={5} glyph={13} />
                      }
                      onClick={() => {
                        setPick(ag);
                        close();
                      }}
                    >
                      {ag.name}
                    </Mi>
                  ))}
                </>
              )}
            </Pop>
          </div>
        </div>
        <div className="hx-hometabs">
          {[
            ["agents", "Your agents"],
            ["templates", "Templates"],
          ].map(([k, l]) => (
            <button
              type="button"
              key={k}
              className={cx(tab === k && "on")}
              onClick={() => setTab(k)}
            >
              {l}
            </button>
          ))}
          <span className="grow" />
          <button
            type="button"
            className="btn hx-sm"
            onClick={() => setPick(null)}
          >
            <Plus size={14} />
            New agent
          </button>
        </div>
        <div className="hx-homelist">
          {tab === "agents" ? (
            AGENTS.map((ag) => (
              <button
                type="button"
                className="hx-hrow"
                key={ag.id}
                onClick={() => a.openAgent(ag.id)}
              >
                <AgentChip agent={ag} size={34} radius={9} glyph={17} />
                <span className="col grow" style={{ minWidth: 0 }}>
                  <span className="hx-hname cut">{ag.name}</span>
                  <span className="hx-hdesc cut">{ag.desc}</span>
                </span>
              </button>
            ))
          ) : (
            <>
              {TEMPLATES.slice(0, 5).map(([t, d, c]) => (
                <button
                  type="button"
                  className="hx-hrow"
                  key={t}
                  onClick={() =>
                    setText(`Build an agent: ${t.toLowerCase()}. ${d}`)
                  }
                >
                  <AgentChip
                    agent={{ icon: "robot", color: c }}
                    size={34}
                    radius={9}
                    glyph={17}
                  />
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <span className="hx-hname cut">{t}</span>
                    <span className="hx-hdesc cut">{d}</span>
                  </span>
                </button>
              ))}
              <button type="button" className="hx-hrow">
                <span className="hx-dashtile">
                  <ListBullets size={17} />
                </span>
                <span className="hx-hname grow">Browse all 48 templates</span>
                <ArrowRight size={16} className="t3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- agents */

export function AgentsPage({ a }) {
  const [q, setQ] = useState("");
  const [cards, setCards] = useState(false);
  const list = AGENTS.filter((x) =>
    x.name.toLowerCase().includes(q.toLowerCase()),
  );
  const groups = ["Waiting", "This week", "This month", "Older"];
  return (
    <div className="hx-scroll">
      <div className="hx-list960">
        <div className="row g8 hx-pagetitle">
          <h1>Agents</h1>
          <span className="grow" />
          <button type="button" className="btn">
            <BookOpen size={14} />
            How agents work
          </button>
          <Pop
            align="right"
            trigger={({ toggle }) => (
              <button
                type="button"
                className="btn primary hx-r6"
                onClick={toggle}
              >
                <Plus size={14} />
                New agent
              </button>
            )}
            menuClass="hx-w320"
          >
            {(close) => (
              <>
                {[
                  [
                    PencilSimple,
                    "Start from scratch",
                    "Start with an empty agent and shape it in chat",
                  ],
                  [UploadSimple, "Upload", "An agent template .zip"],
                  [
                    GithubLogo,
                    "Import from a repo",
                    "Scan a public GitHub repository for agent templates",
                  ],
                ].map(([I, t, d]) => (
                  <button
                    type="button"
                    key={t}
                    className="mi hx-mi2"
                    onClick={() => {
                      close();
                      a.set({ page: "home", homeCreate: true });
                    }}
                  >
                    <I size={16} />
                    <span className="col grow">
                      <span>{t}</span>
                      <span className="xs t2">{d}</span>
                    </span>
                  </button>
                ))}
                <div className="msep" />
                <Mi onClick={close}>Browse all templates</Mi>
              </>
            )}
          </Pop>
        </div>
        <div className="row g8" style={{ margin: "20px 0 12px" }}>
          <label className="hx-search">
            <MagnifyingGlass size={14} className="t3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search agents by name…"
              aria-label="Search agents"
            />
          </label>
          <button
            type="button"
            className="hx-iconbtn"
            aria-label="Filter agents"
          >
            <Funnel size={14} />
          </button>
          <span className="grow" />
          <span className="seg">
            <button
              type="button"
              className={cx(!cards && "on")}
              aria-label="List"
              onClick={() => setCards(false)}
            >
              <ListBullets size={14} />
            </button>
            <button
              type="button"
              className={cx(cards && "on")}
              aria-label="Cards"
              onClick={() => setCards(true)}
            >
              <SquaresFour size={14} />
            </button>
          </span>
        </div>
        {!list.length ? (
          <div className="hx-emptybox">
            <span className="b5">Nothing matches “{q}”</span>
            <span className="sm t2">
              Try a shorter search, or check the filters — they narrow this list
              too.
            </span>
          </div>
        ) : cards ? (
          <div className="hx-cards">
            {list.map((ag) => (
              <button
                type="button"
                className="hx-card"
                key={ag.id}
                onClick={() => a.openAgent(ag.id)}
              >
                <AgentChip agent={ag} size={32} radius={8} />
                <span className="b5" style={{ fontSize: 14 }}>
                  {ag.name}
                </span>
                <span className="sm t2">{ag.desc}</span>
                <span className="xs t3">
                  {ag.owner} · {ag.lastActive}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="atbl">
            <div className="ath">
              <span>Agent</span>
              <span>Owner</span>
              <span>Last active</span>
              <span />
            </div>
            {groups.map((g) => {
              const rows = list.filter((x) => x.group === g);
              if (!rows.length) return null;
              return (
                <div key={g}>
                  <div className="psgroup">{g}</div>
                  {rows.map((ag) => (
                    <div
                      className="atr"
                      key={ag.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => a.openAgent(ag.id)}
                      onKeyDown={onPress(() => a.openAgent(ag.id))}
                    >
                      <span className="row g12" style={{ minWidth: 0 }}>
                        <AgentChip agent={ag} size={28} radius={7} glyph={15} />
                        <span className="col" style={{ minWidth: 0 }}>
                          <span className="row g6">
                            <span
                              className="b5 cut"
                              style={{ fontSize: 14, lineHeight: "18px" }}
                            >
                              {ag.name}
                            </span>
                            {ag.waiting ? (
                              <span className="wchip">
                                {ag.waiting} waiting
                              </span>
                            ) : null}
                          </span>
                          <span
                            className="cut t2"
                            style={{ fontSize: 13, lineHeight: "16px" }}
                          >
                            {ag.desc}
                          </span>
                        </span>
                      </span>
                      <span className="sm">{ag.owner}</span>
                      <span className="sm t2">{ag.lastActive}</span>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Pop
                          align="right"
                          trigger={({ toggle }) => (
                            <Ib
                              label="Actions"
                              className="sm6"
                              onClick={toggle}
                            >
                              <DotsThreeVertical size={14} weight="bold" />
                            </Ib>
                          )}
                          menuClass="hx-w200"
                        >
                          {(close) => (
                            <>
                              <Mi
                                onClick={() => {
                                  close();
                                  a.openAgent(ag.id);
                                }}
                              >
                                Open
                              </Mi>
                              <Mi onClick={close}>Rename</Mi>
                              <Mi onClick={close}>Export agent</Mi>
                              <div className="msep" />
                              <Mi onClick={close}>Archive agent</Mi>
                            </>
                          )}
                        </Pop>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- skills */

const SkillMark = () => (
  <span className="hx-skmark">
    <Compass size={14} />
  </span>
);

function SkillDrawer({ a, skill }) {
  const [file, setFile] = useState(skill.files[0]);
  const [body, setBody] = useState(skill.body);
  const [desc, setDesc] = useState(skill.desc);
  const [adv, setAdv] = useState(false);
  const [hide, setHide] = useState(false);
  const [exec, setExec] = useState(skill.files.some((f) => f.endsWith(".py")));
  const [added, setAdded] = useState({});
  const edited = (body !== skill.body ? 1 : 0) + (desc !== skill.desc ? 1 : 0);
  const close = () => a.set({ skill: null });
  return (
    <>
      <div className="mask" onClick={close} />
      <div
        className="drawer hx-skdrawer"
        role="dialog"
        aria-label={skill.title}
      >
        <div className="row g8" style={{ padding: "12px 16px" }}>
          <SkillMark />
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="b6 sm mono13">{skill.title}</span>
            <span className="xs t2 row g4">
              Shared in your skill registry <Info size={12} />
            </span>
          </div>
          <Pop
            align="right"
            trigger={({ toggle }) => (
              <button type="button" className="btn" onClick={toggle}>
                <Plus size={14} />
                Add to agent
              </button>
            )}
            menuClass="hx-w280"
          >
            {() => (
              <>
                <div className="mh">Add {skill.title} to</div>
                {AGENTS.map((ag) => {
                  const on = added[ag.id] ?? ag.skills.includes(skill.id);
                  return (
                    <button
                      type="button"
                      key={ag.id}
                      className="mi"
                      onClick={() => setAdded((x) => ({ ...x, [ag.id]: !on }))}
                    >
                      <span className={cx("cbx", on && "on")}>
                        {on ? <Check size={11} weight="bold" /> : null}
                      </span>
                      <AgentChip agent={ag} size={20} radius={5} glyph={12} />
                      <span className="cut grow">{ag.name}</span>
                    </button>
                  );
                })}
              </>
            )}
          </Pop>
          <Pop
            align="right"
            trigger={({ toggle }) => (
              <Ib label="More" onClick={toggle}>
                <DotsThree size={16} weight="bold" />
              </Ib>
            )}
            menuClass="hx-w240"
          >
            {(c) => (
              <>
                <Mi icon={<Archive size={16} />} onClick={c}>
                  Archive
                </Mi>
                <Mi icon={<DownloadSimple size={16} />} onClick={c}>
                  Download as .zip
                </Mi>
                <Mi icon={<DownloadSimple size={16} />} onClick={c}>
                  Download SKILL.md
                </Mi>
              </>
            )}
          </Pop>
          <Ib label="Close" onClick={close}>
            <X size={16} />
          </Ib>
        </div>
        <div className="skbar">
          <Pop
            trigger={({ toggle, open }) => (
              <button
                type="button"
                className={cx("skfilebtn", open && "open")}
                onClick={toggle}
              >
                <FileIcon size={14} />
                <span className="mono xs">{file}</span>
                <CaretUpDown size={12} className="t3" />
              </button>
            )}
            menuClass="skmenu"
          >
            {(c) =>
              skill.files.map((f) => (
                <Mi
                  key={f}
                  cur={f === file}
                  icon={<FileIcon size={14} />}
                  onClick={() => {
                    setFile(f);
                    c();
                  }}
                >
                  <span className="mono">{f}</span>
                </Mi>
              ))
            }
          </Pop>
          <Ib label="Delete file">
            <Trash size={14} />
          </Ib>
          <span className="grow" />
          <span className="xs t2">
            {skill.files.length} files · {edited} edited
          </span>
        </div>
        <div className="hx-skform">
          {file === "SKILL.md" ? (
            <>
              <label className="col g6">
                <span className="hx-flabel">Name</span>
                <input className="field mono13" defaultValue={skill.title} />
              </label>
              <label className="col g6">
                <span className="hx-flabel">Description</span>
                <input
                  className="field"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="When the agent should reach for this skill"
                />
              </label>
              <textarea
                className="field hx-skbody mono13"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="# My skill…"
                aria-label="Skill body"
              />
              <button
                type="button"
                className="row g6 sm b5 hx-advtoggle"
                onClick={() => setAdv(!adv)}
              >
                <CaretDown size={12} className={cx("hx-rot", adv && "on")} />
                Advanced
              </button>
              {adv ? (
                <div className="col g8">
                  <div className="lrow">
                    <Switch
                      on={hide}
                      onChange={setHide}
                      label="Hide from prompt"
                    />
                    <span>Hide from prompt</span>
                  </div>
                  <div className="lrow">
                    <Switch
                      on={exec}
                      onChange={setExec}
                      label="Allow executable files"
                    />
                    <span>Allow executable files</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <textarea
              className="field hx-skbody mono13"
              defaultValue={`# ${file
                .split("/")
                .pop()
                .replace(
                  /\.\w+$/,
                  "",
                )}\n\nThe rules and examples the skill reads.`}
              aria-label={file}
            />
          )}
        </div>
      </div>
    </>
  );
}

export function SkillsPage({ a, s }) {
  const [q, setQ] = useState("");
  const list = SKILLS.filter((x) =>
    (x.title + x.desc).toLowerCase().includes(q.toLowerCase()),
  );
  const skill = SKILLS.find((x) => x.id === s.skill);
  return (
    <>
      <div className="hx-scroll">
        <div className="hx-list1248">
          <div className="row g8 hx-pagetitle">
            <h1>Skills</h1>
            <span className="grow" />
            <button type="button" className="btn">
              <BookOpen size={14} />
              How skills work
            </button>
            <Pop
              align="right"
              trigger={({ toggle }) => (
                <button
                  type="button"
                  className="btn primary hx-r6"
                  onClick={toggle}
                >
                  <Plus size={14} />
                  New skill
                </button>
              )}
              menuClass="hx-w320"
            >
              {(close) =>
                [
                  [
                    PencilSimple,
                    "Write from scratch",
                    "Start with an empty SKILL.md and write it here",
                  ],
                  [
                    UploadSimple,
                    "Upload",
                    "A .zip, .skill or SKILL.md, opened in the editor",
                  ],
                  [
                    GithubLogo,
                    "Import from a repo",
                    "Scan a public GitHub repository for SKILL.md folders",
                  ],
                ].map(([I, t, d]) => (
                  <button
                    type="button"
                    key={t}
                    className="mi hx-mi2"
                    onClick={close}
                  >
                    <I size={16} />
                    <span className="col grow">
                      <span>{t}</span>
                      <span className="xs t2">{d}</span>
                    </span>
                  </button>
                ))
              }
            </Pop>
          </div>
          <div className="row g8" style={{ margin: "20px 0 12px" }}>
            <label className="hx-search">
              <MagnifyingGlass size={14} className="t3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search skills by name…"
                aria-label="Search skills"
              />
            </label>
            <button
              type="button"
              className="hx-iconbtn"
              aria-label="Filter skills"
            >
              <Funnel size={14} />
            </button>
          </div>
          <div className="atbl hx-sktbl">
            <div className="ath">
              <span>Name</span>
              <span>Source</span>
              <span>Used by</span>
              <span>Last updated</span>
              <span />
            </div>
            {list.map((sk) => (
              <div
                className="atr"
                key={sk.id}
                role="button"
                tabIndex={0}
                onClick={() => a.set({ skill: sk.id })}
                onKeyDown={onPress(() => a.set({ skill: sk.id }))}
              >
                <span className="row g12" style={{ minWidth: 0 }}>
                  <SkillMark />
                  <span className="col" style={{ minWidth: 0 }}>
                    <span
                      className="cut"
                      style={{ fontSize: 13, lineHeight: "18px" }}
                    >
                      {sk.title}
                    </span>
                    <span className="cut t2" style={{ fontSize: 13 }}>
                      {sk.desc}
                    </span>
                  </span>
                </span>
                <span className="sm">{sk.source}</span>
                <span className="sm">
                  <span className="skused">
                    {sk.usedBy} {sk.usedBy === 1 ? "agent" : "agents"}
                  </span>
                </span>
                <span className="sm t2">{sk.updated}</span>
                <span />
              </div>
            ))}
          </div>
        </div>
      </div>
      {skill ? <SkillDrawer a={a} skill={skill} key={skill.id} /> : null}
    </>
  );
}

/* ---------------------------------------------------------------- automations */

/** AutomationKindMark: a 28px tile, orange Lightning for events, purple ClockClockwise for schedules. */
const KindMark = ({ kind }) => (
  <span className={cx("hx-akind", kind)}>
    {kind === "event" ? <Lightning size={15} /> : <ClockClockwise size={15} />}
  </span>
);
/** AutomationStatusMark: a 6px dot and a word. */
const StatusMark = ({ status }) => (
  <span className={cx("hx-astatus", status === "Working" ? "ok" : "off")}>
    <i />
    {status}
  </span>
);

function AutomationMenu({ a, x, on, setOn, detail }) {
  return (
    <Pop
      align="right"
      trigger={({ toggle }) => (
        <Ib label="Actions" className="sm6" onClick={toggle}>
          <DotsThreeVertical size={detail ? 16 : 14} weight="bold" />
        </Ib>
      )}
      menuClass="hx-w200"
    >
      {(close) =>
        detail ? (
          <Mi icon={<Trash size={14} />} onClick={close}>
            <span className="hx-red">Delete</span>
          </Mi>
        ) : (
          <>
            <Mi icon={<Play size={14} />} onClick={close}>
              Run now
            </Mi>
            <Mi
              icon={<ClockCounterClockwise size={14} />}
              onClick={() => {
                close();
                a.set({ automation: x.id, automationView: "runs" });
              }}
            >
              Run history
            </Mi>
            <Mi
              icon={on ? <Pause size={14} /> : <Play size={14} />}
              onClick={() => {
                setOn(!on);
                close();
              }}
            >
              {on ? "Deactivate" : "Activate"}
            </Mi>
            <div className="msep" />
            <Mi icon={<Trash size={14} />} onClick={close}>
              <span className="hx-red">Delete</span>
            </Mi>
          </>
        )
      }
    </Pop>
  );
}

function AutomationList({ a }) {
  const [q, setQ] = useState("");
  const [paused, setPaused] = useState(() =>
    Object.fromEntries(AUTOMATIONS.map((x) => [x.id, x.status === "Paused"])),
  );
  const rows = AUTOMATIONS.filter((x) =>
    x.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="hx-scroll">
      <div className="hx-list1248 hx-autolist">
        <div className="row g8 hx-pagetitle">
          <h1>Automations</h1>
          <span className="grow" />
          <button type="button" className="btn">
            <BookOpen size={14} />
            How automations work
          </button>
          <button type="button" className="btn primary hx-btn32">
            <Plus size={14} />
            New automation
          </button>
        </div>
        <div className="row g8" style={{ margin: "20px 0 12px" }}>
          <label className="hx-search" style={{ width: 340 }}>
            <MagnifyingGlass size={14} className="t3" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search automations"
              aria-label="Search automations"
            />
          </label>
          <button
            type="button"
            className="hx-iconbtn"
            aria-label="Filter automations"
          >
            <Funnel size={14} />
          </button>
          <span className="grow" />
          <span className="seg">
            <button type="button" className="on" aria-label="List">
              <ListBullets size={14} />
            </button>
            <button type="button" aria-label="Cards">
              <SquaresFour size={14} />
            </button>
          </span>
        </div>
        {rows.length ? (
          <div className="hx-atable">
            <div className="hx-athead">
              <span>Automation</span>
              <span>Status</span>
              <span>Runs when</span>
              <span>Last run</span>
              <span>Agent</span>
              <span />
            </div>
            {rows.map((x) => {
              const ag = AGENTS.find((g) => g.id === x.agent);
              const on = !paused[x.id];
              const open = () =>
                a.set({ automation: x.id, automationView: null });
              return (
                <div
                  className="hx-atrow"
                  key={x.id}
                  role="button"
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={onPress(open)}
                >
                  <span className="row g8" style={{ minWidth: 0 }}>
                    <KindMark kind={x.kind} />
                    <span className="cut" style={{ fontSize: 14 }}>
                      {x.name}
                    </span>
                  </span>
                  <StatusMark status={on ? "Working" : "Paused"} />
                  <span className="cut sm t2">{x.when}</span>
                  <span className="col" style={{ minWidth: 0 }}>
                    <span className="sm">{x.last}</span>
                    <span className="xs t2">{x.runs}</span>
                  </span>
                  <span className="row g6" style={{ minWidth: 0 }}>
                    <AgentChip agent={ag} size={20} radius={5} glyph={13} />
                    <span className="cut sm">{ag.name}</span>
                  </span>
                  <span
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <AutomationMenu
                      a={a}
                      x={x}
                      on={on}
                      setOn={(v) => setPaused((p) => ({ ...p, [x.id]: !v }))}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="hx-emptybox">
            <span className="b5">Nothing matches “{q}”</span>
            <span className="sm t2">
              Try a shorter search, or check the filters — they narrow this list
              too.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AutomationDetail({ a, x }) {
  const ag = AGENTS.find((g) => g.id === x.agent);
  const [on, setOn] = useState(x.status !== "Paused");
  const [text, setText] = useState(x.instruction);
  const dirty = text !== x.instruction;
  const back = () => a.set({ automation: null, automationView: null });
  const runs = () => a.set({ automationView: "runs" });
  return (
    <div className="hx-scroll">
      <div className="hx-adetail">
        <button type="button" className="hx-aback" onClick={back}>
          <ArrowLeft size={13} />
          Automations
        </button>
        <div
          className="row g8"
          style={{ alignItems: "flex-start", marginTop: 12 }}
        >
          <h1 className="hx-atitle grow">{x.name}</h1>
          <AutomationMenu a={a} x={x} detail />
        </div>
        <div className="hx-ameta">
          <span className="row g8">
            <Switch on={on} onChange={setOn} label="On" />
            <span style={{ fontSize: 14 }}>{on ? "On" : "Off"}</span>
          </span>
          <span className="vsep" style={{ height: 16 }} />
          <span className="sm t2">
            Runs {ag.name} · {x.edited}
          </span>
        </div>
        <div className="hx-asec">
          <div className="row">
            <h2>Runs</h2>
            <span className="grow" />
            <button
              type="button"
              className="btn hx-compact"
              title="Run this automation now in a new session"
            >
              <Play size={14} />
              Run now
            </button>
          </div>
          <div className="hx-abox">
            {x.next && on ? (
              <div className="hx-arow">
                <span className="hx-alabel">Next run</span>
                <span className="grow sm">{x.next}</span>
              </div>
            ) : null}
            <button type="button" className="hx-arow" onClick={runs}>
              <span className="hx-alabel">Last run</span>
              <span className="grow sm row g8">
                <i className={cx("hx-rdot", x.lastOk ? "ok" : "fail")} />
                {x.lastRun}
                {x.lastOk ? "" : " · did not finish"}
              </span>
              <CaretRight size={12} className="t3" />
            </button>
            <button type="button" className="hx-arow" onClick={runs}>
              <span className="hx-alabel">History</span>
              <span className="grow sm">See all runs</span>
              <CaretRight size={12} className="t3" />
            </button>
          </div>
        </div>
        <div className="hx-asec">
          <h2>Settings</h2>
          <div className="col" style={{ gap: 22, marginTop: 12 }}>
            <div className="col" style={{ gap: 7 }}>
              <span className="hx-flabel">Agent</span>
              <button type="button" className="field hx-selectfield row g8">
                <AgentChip agent={ag} size={20} radius={5} glyph={13} />
                <span className="grow cut">{ag.name}</span>
                <CaretUpDown size={14} className="t3" />
              </button>
              <span className="xs t2">The agent this automation runs.</span>
            </div>
            <div className="col" style={{ gap: 7 }}>
              <span className="hx-flabel">Runs when</span>
              <button type="button" className="field hx-selectfield row g8">
                <KindMark kind={x.kind} />
                <span className="grow cut">{x.when}</span>
                <CaretUpDown size={14} className="t3" />
              </button>
              <span className="xs t2">
                {!on
                  ? "Paused — it won't run until you switch it on."
                  : x.kind === "event"
                    ? "Runs each time this event arrives."
                    : ""}
              </span>
            </div>
            <div className="col" style={{ gap: 7 }}>
              <span className="hx-flabel">Instruction</span>
              <div className="composer" style={{ margin: 0 }}>
                <textarea
                  className="hx-ainstr"
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="Instruction"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="hx-asave">
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => setText(x.instruction)}
          >
            Discard
          </button>
          <button type="button" className="btn primary" disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function AutomationRuns({ a, x }) {
  const [sel, setSel] = useState("Today-0");
  const flat = RUNS.flatMap(([d, rs]) =>
    rs.map((r, i) => ({ key: `${d}-${i}`, day: d, r })),
  );
  const cur = flat.find((f) => f.key === sel) ?? flat[0];
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div className="hx-acrumbs">
        <button
          type="button"
          onClick={() => a.set({ automation: null, automationView: null })}
        >
          Automations
        </button>
        <span className="t3">›</span>
        <button type="button" onClick={() => a.set({ automationView: null })}>
          {x.name}
        </button>
        <span className="t3">›</span>
        <span className="b6">Run history</span>
      </div>
      <div className="row grow" style={{ minHeight: 0, alignItems: "stretch" }}>
        <div className="hx-runlist">
          <div className="row" style={{ padding: "0 4px" }}>
            <h1 className="grow" style={{ fontSize: 16, fontWeight: 600 }}>
              Run history
            </h1>
            <Ib label="Filter runs">
              <Funnel size={14} />
            </Ib>
          </div>
          <span className="sm t2" style={{ padding: "0 4px 8px" }}>
            {x.runs}
          </span>
          {RUNS.map(([d, rs]) => (
            <div key={d}>
              <div className="hx-runday">{d}</div>
              {rs.map(([label, time, st], i) => (
                <button
                  type="button"
                  key={i}
                  className={cx("hx-runrow", sel === `${d}-${i}` && "on")}
                  onClick={() => setSel(`${d}-${i}`)}
                >
                  <i className={cx("hx-rdot", st)} />
                  <span className="grow sm">{label}</span>
                  <span className="xs t2">{time}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="col grow" style={{ minWidth: 0 }}>
          <div className="hx-runhead">
            <i className={cx("hx-rdot", cur.r[2])} />
            <span className="b5" style={{ fontSize: 14 }}>
              {cur.r[0]}
            </span>
            <span className="xs t2">
              {cur.day} {cur.r[1]} · {cur.r[3]}
            </span>
          </div>
          <div className="thread">
            <div className="in">
              <div className="ub">{x.instruction}</div>
              <div className="as">
                {cur.r[2] === "ok" ? (
                  <p>
                    Done. I posted 14 open tickets in #support-urgent: 3 high, 7
                    medium and 4 low.
                  </p>
                ) : (
                  <div className="errbox">
                    The run stopped before it finished: the Zendesk connection
                    had expired.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AutomationsPage({ a, s }) {
  const x = AUTOMATIONS.find((y) => y.id === s.automation);
  if (!x) return <AutomationList a={a} />;
  if (s.automationView === "runs") return <AutomationRuns a={a} x={x} />;
  return <AutomationDetail a={a} x={x} key={x.id} />;
}

export { BotIcon };
