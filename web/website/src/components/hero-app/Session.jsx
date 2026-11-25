import { useState } from "react";
import {
  CaretDown,
  CaretUpDown,
  Export,
  FolderSimple,
  SlidersHorizontal,
  Paperclip,
  ArrowUp,
  CaretRight,
  Plus,
  Chats,
  ClockCounterClockwise,
  PencilSimple,
  DownloadSimple,
  Archive,
  Check,
  LockSimple,
  Users,
  Link as LinkIcon,
  X,
  MagnifyingGlass,
  Wrench,
} from "./ph.jsx";
import { BotIcon, BuilderIcon } from "./icons.jsx";
import { MEMBERS, WORKSPACE, sessionById, sessionsOf } from "./data.js";
import { Avatar, Bullet, Ib, Mi, Pop, cx, initialsOf } from "./Common.jsx";

/** "Worked for 5 s" with its steps (ActivityTimeline). */
function Worked({ label, steps }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="act">
      <button
        type="button"
        className="sum"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
        <CaretRight
          size={10}
          weight="bold"
          className={cx("car", open && "open")}
        />
      </button>
      {open ? (
        <div className="steps">
          {steps.map((t) => (
            <div className="step" key={t}>
              <span className="node">
                <Wrench size={13} />
              </span>
              <span className="cut">{t}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Composer({ placeholder, children, style }) {
  const [text, setText] = useState("");
  return (
    <div className="composer" style={style}>
      {children}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="row g8">
        <Paperclip size={16} className="t3" />
        <span className="grow" />
        <button
          type="button"
          className={cx("send", !text && "off")}
          aria-label="Send"
          onClick={() => setText("")}
        >
          <ArrowUp size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}

/** The session header strip (agent-layout/SessionHeader). */
export function SessionStrip({ a, s, agent, session }) {
  return (
    <div className="sstrip">
      <span className="kind" style={{ width: 24, height: 24 }}>
        <BotIcon size={14} />
      </span>
      <Pop
        trigger={({ toggle, open }) => (
          <button
            type="button"
            className={cx("seg2t", open && "open")}
            aria-haspopup="menu"
            onClick={toggle}
          >
            <span className="b6" style={{ fontSize: 15 }}>
              {agent.name}
            </span>
            <CaretDown size={14} className="t3" />
          </button>
        )}
        menuClass="hx-w240"
      >
        {(close) => (
          <>
            <Mi icon={<ClockCounterClockwise size={16} />} onClick={close}>
              History
            </Mi>
            <Mi icon={<PencilSimple size={16} />} onClick={close}>
              Rename
            </Mi>
            <Mi icon={<DownloadSimple size={16} />} onClick={close}>
              Export agent
            </Mi>
            <div className="msep" />
            <Mi icon={<Archive size={16} />} onClick={close}>
              Archive agent
            </Mi>
          </>
        )}
      </Pop>
      <span className="hx-rev">{agent.version}</span>
      <span className="grow" />
      <Pop
        align="right"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            className={cx("pop", open && "open")}
            style={{ maxWidth: 240 }}
            onClick={toggle}
          >
            <Bullet status={session.status} />
            <span className="cut b5">{session.title}</span>
            <CaretUpDown size={14} className="t3" />
          </button>
        )}
        menuClass="hx-w320"
      >
        {(close) => (
          <>
            <div className="find">
              <MagnifyingGlass size={14} />
              <span>Search sessions</span>
            </div>
            {sessionsOf(agent.id).map((x) => (
              <Mi
                key={x.id}
                cur={x.id === session.id}
                icon={<Bullet status={x.status} />}
                onClick={() => {
                  close();
                  a.openSession(x.id, agent.id);
                }}
              >
                {x.title}
              </Mi>
            ))}
            <div className="msep" />
            <Mi icon={<Plus size={16} />} onClick={close}>
              New session
            </Mi>
            <Mi
              icon={<Chats size={16} />}
              onClick={() => {
                close();
                a.openAgent(agent.id, "sessions");
              }}
            >
              Sessions
            </Mi>
          </>
        )}
      </Pop>
      <span className="vsep" />
      <Ib label="Share the conversation" onClick={() => a.set({ share: true })}>
        <Export size={16} />
      </Ib>
      <Ib
        label="Files"
        on={s.panel === "files"}
        onClick={() => a.togglePanel("files")}
      >
        <FolderSimple size={16} />
      </Ib>
      <Ib
        label="Configuration"
        on={s.panel === "config"}
        onClick={() => a.togglePanel("config")}
      >
        <SlidersHorizontal size={16} />
      </Ib>
      <Ib
        label="Builder"
        on={s.panel === "builder"}
        onClick={() => a.togglePanel("builder")}
      >
        <BuilderIcon size={16} />
      </Ib>
    </div>
  );
}

export function SessionView({ a, s, agent }) {
  const session = sessionById(s.session);
  return (
    <>
      <SessionStrip a={a} s={s} agent={agent} session={session} />
      <div className="thread">
        <div className="in" key={session.id}>
          <div className="ub">{session.user}</div>
          <Worked label={session.worked} steps={session.steps} />
          <div className="as">
            {session.reply.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
          {session.status === "waiting" ? (
            <div className="hx-approval">
              <span className="b5 sm">
                Add the draft reply to ticket #48219?
              </span>
              <span className="grow" />
              <button type="button" className="btn ghost">
                Deny
              </button>
              <button type="button" className="btn primary">
                Approve
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ padding: "0 32px 16px" }}>
        <Composer
          placeholder={`Message ${agent.name}`}
          style={{ margin: "0 auto", maxWidth: 720 }}
        />
      </div>
    </>
  );
}

/** "Share this chat" (agenta-sessions-ui/sharing/SessionShareDialog). */
export function ShareDialog({ a, s }) {
  const session = sessionById(s.session);
  const [people, setPeople] = useState([]);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("Can view");
  const [access, setAccess] = useState("Private");
  const [copied, setCopied] = useState(false);
  const close = () => a.set({ share: false });
  const candidates = MEMBERS.filter(
    (m) => !m.you && !people.some((p) => p.email === m.email),
  );
  const matches = query
    ? candidates.filter((m) =>
        (m.name + m.email).toLowerCase().includes(query.toLowerCase()),
      )
    : candidates;
  const add = (m) => {
    setPeople((p) => [...p, { ...m, grant: role }]);
    setQuery("");
  };
  return (
    <>
      <div className="mask" onClick={close} />
      <div
        className="hx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Share this chat"
      >
        <div className="hx-dlg-h">
          <div className="col grow" style={{ minWidth: 0 }}>
            <span className="hx-dlg-t">Share this chat</span>
            <span className="sm t2 cut">{session.title}</span>
          </div>
          <Ib label="Close" onClick={close}>
            <X size={16} />
          </Ib>
        </div>
        <div className="hx-dlg-b">
          <div className="row g8">
            <Pop
              className="grow"
              trigger={({ toggle }) => (
                <input
                  className="field grow hx-input"
                  value={query}
                  placeholder="Add people by name or email"
                  onFocus={toggle}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
              menuClass="hx-pick"
            >
              {(closeMenu) => (
                <>
                  <div className="mh">Members of {WORKSPACE.name}</div>
                  {matches.length ? (
                    matches.map((m) => (
                      <Mi
                        key={m.email}
                        icon={
                          <Avatar initials={initialsOf(m.name)} size={22} />
                        }
                        onClick={() => {
                          add(m);
                          closeMenu();
                        }}
                        end={m.email}
                      >
                        {m.name}
                      </Mi>
                    ))
                  ) : (
                    <div className="hx-empty-line">No member matches.</div>
                  )}
                  <div className="msep" />
                  <div className="hx-empty-line">
                    You can only add members of this project.
                  </div>
                </>
              )}
            </Pop>
            <Pop
              align="right"
              trigger={({ toggle }) => (
                <button type="button" className="pop" onClick={toggle}>
                  {role}
                  <CaretDown size={12} className="t3" />
                </button>
              )}
              menuClass="hx-w280"
            >
              {(closeMenu) => (
                <>
                  {[
                    [
                      "Can view",
                      "Can read the chat. Cannot send or answer approvals.",
                    ],
                    [
                      "Can send",
                      "Can read, send messages and answer approvals.",
                    ],
                  ].map(([r, d]) => (
                    <button
                      type="button"
                      key={r}
                      className={cx("mi hx-mi2", role === r && "cur")}
                      onClick={() => {
                        setRole(r);
                        closeMenu();
                      }}
                    >
                      <span className="col grow">
                        <span>{r}</span>
                        <span className="xs t2">{d}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </Pop>
            <button
              type="button"
              className="btn primary"
              onClick={() => matches[0] && query && add(matches[0])}
            >
              Invite
            </button>
          </div>
          <div className="hx-label">People with access</div>
          <div className="hx-person">
            <Avatar initials={WORKSPACE.user.initials} size={28} />
            <span className="col grow" style={{ minWidth: 0 }}>
              <span className="b5">{WORKSPACE.user.name} (you)</span>
              <span className="xs t2">{WORKSPACE.user.email}</span>
            </span>
            <span className="hx-role sm t2">Owner</span>
          </div>
          {people.map((p) => (
            <div className="hx-person" key={p.email}>
              <Avatar initials={initialsOf(p.name)} size={28} />
              <span className="col grow" style={{ minWidth: 0 }}>
                <span className="b5">{p.name}</span>
                <span className="xs t2">{p.email}</span>
              </span>
              <Pop
                align="right"
                className="hx-role"
                trigger={({ toggle }) => (
                  <button type="button" className="btn ghost" onClick={toggle}>
                    {p.grant}
                    <CaretDown size={12} />
                  </button>
                )}
                menuClass="hx-w200"
              >
                {(closeMenu) => (
                  <>
                    {["Can view", "Can send"].map((r) => (
                      <Mi
                        key={r}
                        cur={p.grant === r}
                        onClick={() => {
                          setPeople((all) =>
                            all.map((x) =>
                              x.email === p.email ? { ...x, grant: r } : x,
                            ),
                          );
                          closeMenu();
                        }}
                      >
                        {r}
                      </Mi>
                    ))}
                    <div className="msep" />
                    <Mi
                      onClick={() => {
                        setPeople((all) =>
                          all.filter((x) => x.email !== p.email),
                        );
                        closeMenu();
                      }}
                    >
                      <span className="hx-red">Remove access</span>
                    </Mi>
                  </>
                )}
              </Pop>
            </div>
          ))}
          {!people.length ? (
            <div className="xs t2" style={{ paddingLeft: 36 }}>
              No one else has access yet.
            </div>
          ) : null}
          <div className="hx-label">General access</div>
          <div className="hx-person">
            <span className="hx-circ">
              {access === "Private" ? (
                <LockSimple size={14} />
              ) : (
                <Users size={14} />
              )}
            </span>
            <span className="col grow" style={{ minWidth: 0 }}>
              <Pop
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    className="hx-ghostsel b5"
                    onClick={toggle}
                  >
                    {access}
                    <CaretDown size={12} />
                  </button>
                )}
                menuClass="hx-w240"
              >
                {(closeMenu) => (
                  <>
                    {["Private", "Shared with project"].map((v) => (
                      <Mi
                        key={v}
                        cur={access === v}
                        onClick={() => {
                          setAccess(v);
                          closeMenu();
                        }}
                      >
                        {v}
                      </Mi>
                    ))}
                  </>
                )}
              </Pop>
              <span className="xs t2">
                {access === "Private"
                  ? "Only you and the people you add can open this chat."
                  : `Everyone in ${WORKSPACE.name} can view this chat and send to it.`}
              </span>
            </span>
          </div>
          {access === "Private" && !people.length ? (
            <div className="hx-note">
              <LinkIcon size={13} />
              Nobody else can open this link yet. Invite people above, or choose
              Shared with project.
            </div>
          ) : null}
        </div>
        <div className="hx-dlg-f">
          <button
            type="button"
            className="btn ghost hx-red"
            onClick={() => {
              setPeople([]);
              setAccess("Private");
            }}
          >
            Stop sharing
          </button>
          <span className="grow" />
          <button
            type="button"
            className="btn ghost"
            onClick={() => setCopied(true)}
          >
            {copied ? <Check size={13} /> : <LinkIcon size={13} />}
            {copied ? "Link copied" : "Copy share link"}
          </button>
          <button type="button" className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
