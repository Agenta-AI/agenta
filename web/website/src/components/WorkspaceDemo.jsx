import {
  ArrowLeft,
  ArrowUp,
  CalendarBlank,
  CaretDoubleRight,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Clock,
  Check,
  Compass,
  ClockCounterClockwise,
  DotsThree,
  FileText,
  Funnel,
  Lightning,
  Paperclip,
  Microphone,
  MagnifyingGlass,
  Plus,
  Robot,
} from "@phosphor-icons/react";
import AutomationHistory from "./workspace-demo/AutomationHistory.jsx";
import PlaygroundSettings from "./workspace-demo/PlaygroundSettings.jsx";
import DemoSidebar from "./workspace-demo/DemoSidebar.jsx";
import { Component, Fragment } from "react";

// Sample workspace content from the approved landing design. All actions stay local.
// CSS declaration strings from the handoff are normalized to React style objects.
function css(value) {
  const result = Object.fromEntries(
    value
      .split(/;(?![^()]*\))/)
      .filter((s) => s.trim())
      .map((part) => {
        const colon = part.indexOf(":");
        const key = part.slice(0, colon).trim();
        return [
          key.startsWith("--")
            ? key
            : key
                .replace(/^-webkit-/, "Webkit-")
                .replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
          part.slice(colon + 1).trim(),
        ];
      }),
  );
  const font = result.font?.match(
    /^(\d+)\s+([\d.]+px)\/([\d.]+(?:px)?)\s+(.+)$/,
  );
  if (font) {
    result.fontWeight ||= font[1];
    result.fontSize ||= font[2];
    result.lineHeight ||= font[3];
    result.fontFamily ||= font[4];
    delete result.font;
  }
  return result;
}

import { deriveWorkspace } from "./workspace-demo/model.js";

const SKILL_LABEL = `font:500 14px/20px var(--font-sans);color:var(--foreground);`;
const SKILL_BOX = `box-sizing:border-box;border-radius:10px;border:1px solid var(--input);font:400 14px/1.6 var(--font-sans);color:var(--foreground);`;
const SKILL_CELL = `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/20px var(--font-sans);color:var(--foreground);`;
const SKILL_SWITCH = `box-sizing:border-box;display:inline-flex;width:28px;height:16px;flex:0 0 auto;align-items:center;border-radius:999px;padding:2px;background:var(--input);`;
const SKILL_SWITCH_THUMB = `width:12px;height:12px;border-radius:999px;background:var(--background);`;

// Shows a skill's steps as rendered markdown: numbered runs become a list.
function renderSkillMarkdown(md) {
  const blocks = [];
  for (const line of md.split("\n")) {
    const step = line.match(/^\d+\. (.*)$/);
    const last = blocks[blocks.length - 1];
    if (step && Array.isArray(last)) last.push(step[1]);
    else if (step) blocks.push([step[1]]);
    else if (line) blocks.push(line);
  }
  return blocks.map((block, i) =>
    Array.isArray(block) ? (
      <ol key={i} style={css(`margin:0 0 10px;padding-left:22px;`)}>
        {block.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    ) : (
      <p key={i} style={css(`margin:0 0 10px;`)}>
        {block}
      </p>
    ),
  );
}

const SAMPLE_NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Casey"];

export default class WorkspaceDemo extends Component {
  componentDidMount() {
    document.addEventListener("keydown", this.onEscape);
    // The hero sidebar asks for a screen; a pre-hydration click waits in __agDemoGo.
    window.addEventListener("ag-demo-go", this.onGo);
    if (window.matchMedia("(max-width: 1100px)").matches)
      this.setState({ sidebarCollapsed: true });
    if (window.__agDemoGo) this.onGo({ detail: window.__agDemoGo });
    this.setState({
      sampleName: SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)],
    });
  }
  componentWillUnmount() {
    document.removeEventListener("keydown", this.onEscape);
    window.removeEventListener("ag-demo-go", this.onGo);
  }
  onLive = () => window.dispatchEvent(new CustomEvent("ag-demo-live"));
  onGo = (event) => {
    window.__agDemoGo = null;
    this.setState({
      session: null,
      automation: null,
      skill: null,
      historyOpen: false,
      playgroundTask: null,
      ...event.detail,
    });
  };
  onEscape = (event) => {
    if (event.key === "Escape" && this.state.skill !== null)
      this.setState({ skill: null });
  };
  componentDidUpdate(_, previous) {
    if (previous.skill === null && this.state.skill !== null) {
      this.returnFocus = document.activeElement;
      this.frame?.querySelector('[aria-label="Back to skills"]')?.focus();
    } else if (previous.skill !== null && this.state.skill === null)
      this.returnFocus?.focus();
  }
  state = {
    view: "home",
    session: null,
    automation: null,
    skill: null,
    homePicker: false,
    homeAgent: 0,
    sampleName: "Alex",
    historyOpen: false,
    ...this.props.initialState,
  };

  render() {
    const {
      nav,
      view,
      railGroups,
      ss,
      configOpen,
      toggleConfig,
      homeAgent,
      homeRows,
      agentRows,
      automationRows,
      hasAutomation,
      noAutomation,
      au,
      closeAutomation,
      skillSections,
      hasSkill,
      sk,
      closeSkill,
      sessionRows,
    } = deriveWorkspace(
      this.state,
      (patch) => this.setState(patch),
      this.onLive,
    );

    return (
      <div
        className={`ag-app-frame ag-over-rail`}
        ref={(node) => {
          this.frame = node;
        }}
        data-sidebar-collapsed={this.state.sidebarCollapsed || false}
        aria-label="Interactive Agenta workspace demo"
        style={css(
          `position:relative;z-index:6;width:min(1120px,100%);height:680px;border-radius:12px;border:1px solid var(--border);box-shadow:0 0 0 6px var(--muted),0 0 0 7px var(--border),var(--ag-boxShadowSecondary);display:grid;grid-template-columns:255px minmax(0,1fr);overflow:hidden;text-align:left;font-family:var(--font-sans);color:var(--foreground);background:var(--background);`,
        )}
      >
        <DemoSidebar
          groups={railGroups}
          selected={view.playground ? ss.name : this.state.view}
          collapsed={this.state.sidebarCollapsed || false}
          onGo={(detail) =>
            detail.live ? this.onLive() : this.onGo({ detail })
          }
          onToggleCollapse={() =>
            this.setState((state) => ({
              sidebarCollapsed: !state.sidebarCollapsed,
            }))
          }
        />
        <div
          className="ag-app-content"
          style={css(
            `display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--background);`,
          )}
        >
          {view.home && (
            <>
              <div
                style={css(
                  `display:flex;flex:1;min-height:0;flex-direction:column;justify-content:center;overflow-y:auto;padding:48px 40px;`,
                )}
              >
                <div
                  style={css(
                    `margin:0 auto;display:flex;width:100%;max-width:620px;flex-direction:column;gap:26px;`,
                  )}
                >
                  <div
                    style={css(
                      `display:flex;flex-direction:column;gap:6px;padding:0 6px;`,
                    )}
                  >
                    <span
                      style={css(
                        `font:400 11px/1 var(--font-mono);text-transform:uppercase;letter-spacing:0.1em;color:var(--muted-foreground);`,
                      )}
                    >{`Good evening, ${this.state.sampleName}`}</span>
                    <h3
                      style={css(
                        `margin:0;font:500 30px/1.25 var(--font-sans);letter-spacing:-0.015em;color:var(--foreground);`,
                      )}
                    >{`What should we work on?`}</h3>
                  </div>
                  <div
                    style={css(
                      `position:relative;display:flex;flex-direction:column;min-height:112px;border-radius:12px;border:1px solid var(--ag-composer-border);background:var(--ag-surface-chat);box-shadow:var(--ag-surface-chat-shadow);`,
                    )}
                  >
                    <div
                      style={css(
                        `flex:1;padding:12px 14px;font:400 14px/20px var(--font-sans);color:var(--ag-composer-placeholder);`,
                      )}
                    >{`Describe the task, or start the conversation…`}</div>
                    <div
                      style={css(
                        `display:flex;align-items:center;gap:4px;padding:6px 8px 8px;`,
                      )}
                    >
                      <span
                        style={css(`position:relative;display:inline-flex;`)}
                      >
                        <button
                          type={`button`}
                          aria-haspopup={`listbox`}
                          aria-expanded={this.state.homePicker}
                          onClick={() =>
                            this.setState((s) => ({
                              homePicker: !s.homePicker,
                            }))
                          }
                          style={css(
                            `display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:6px;border:none;cursor:default;background:${this.state.homePicker ? "var(--accent)" : "transparent"};font:400 14px/1 var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span style={css(homeAgent.chipStyle)}>
                            <Robot
                              size="62%"
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                          {homeAgent.title}
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <CaretDown
                              size={10}
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                        </button>
                        {this.state.homePicker && (
                          <div
                            role={`listbox`}
                            aria-label="Choose an agent"
                            style={css(
                              `position:absolute;left:0;top:calc(100% + 6px);z-index:6;display:flex;width:340px;max-height:300px;flex-direction:column;gap:2px;overflow-y:auto;border-radius:10px;border:1px solid var(--border);background:var(--background);box-shadow:var(--ag-boxShadowSecondary);padding:6px;`,
                            )}
                          >
                            {homeRows.map((r, index7) => (
                              <Fragment key={index7}>
                                <button
                                  type={`button`}
                                  onClick={r.open}
                                  style={css(r.rowStyle)}
                                >
                                  <span style={css(r.tileStyle)}>
                                    <Robot
                                      size="62%"
                                      weight="regular"
                                      aria-hidden="true"
                                    />
                                  </span>
                                  <span
                                    style={css(
                                      `display:flex;min-width:0;flex:1;flex-direction:column;gap:1px;`,
                                    )}
                                  >
                                    <span
                                      style={css(
                                        `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/1.45 var(--font-sans);color:var(--foreground);`,
                                      )}
                                    >
                                      {r.title}
                                    </span>
                                    <span
                                      style={css(
                                        `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/1.45 var(--font-sans);color:var(--muted-foreground);`,
                                      )}
                                    >
                                      {r.desc}
                                    </span>
                                  </span>
                                  {r.selected && (
                                    <span
                                      style={css(
                                        `margin-left:8px;display:inline-flex;flex:0 0 auto;color:var(--foreground);`,
                                      )}
                                    >
                                      <Check
                                        size={14}
                                        weight="regular"
                                        aria-hidden="true"
                                      />
                                    </span>
                                  )}
                                </button>
                              </Fragment>
                            ))}
                            <div
                              style={css(
                                `margin:4px 0;height:1px;flex:0 0 auto;background:var(--ag-colorSplit);`,
                              )}
                            ></div>
                            <button
                              type={`button`}
                              onClick={() =>
                                this.setState({
                                  view: "agents",
                                  homePicker: false,
                                })
                              }
                              style={css(
                                `box-sizing:border-box;display:flex;width:100%;flex:0 0 auto;cursor:default;align-items:center;gap:14px;border-radius:10px;border:none;background:transparent;padding:8px 14px;text-align:left;font:400 14px/1.45 var(--font-sans);color:var(--foreground);`,
                              )}
                            >
                              <span
                                style={css(
                                  `display:flex;width:34px;height:34px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:10px;border:1px dashed var(--border);color:var(--muted-foreground);`,
                                )}
                              >
                                <Plus
                                  size={15}
                                  weight="regular"
                                  aria-hidden="true"
                                />
                              </span>
                              {`New agent`}
                            </button>
                          </div>
                        )}
                      </span>
                      <span style={css(`flex:1;`)}></span>
                      <span
                        style={css(
                          `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:999px;background:var(--primary);color:var(--primary-foreground);`,
                        )}
                      >
                        <ArrowUp
                          size={14}
                          weight="regular"
                          aria-hidden="true"
                        />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          {view.agents && (
            <>
              <div
                style={css(
                  `box-sizing:border-box;flex:0 0 auto;padding:56px 64px 12px;`,
                )}
              >
                <div
                  style={css(
                    `display:flex;min-width:0;align-items:center;gap:8px;`,
                  )}
                >
                  <h3
                    style={css(
                      `margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 24px/1.3333 var(--font-sans);color:var(--foreground);`,
                    )}
                  >{`Agents`}</h3>
                  <span
                    style={css(
                      `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);`,
                    )}
                  >
                    <Plus size={14} weight="regular" aria-hidden="true" />
                    {`New agent`}
                  </span>
                </div>
              </div>
              <div
                style={css(
                  `min-width:0;padding:12px 64px 48px;flex:1;min-height:0;overflow-y:auto;`,
                )}
              >
                <div
                  style={css(
                    `margin-bottom:12px;display:flex;align-items:center;gap:8px;`,
                  )}
                >
                  <span
                    style={css(
                      `display:inline-flex;min-width:0;max-width:340px;flex:1;height:32px;align-items:center;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--placeholder);background:transparent;`,
                    )}
                  >
                    <span
                      style={css(
                        `display:inline-flex;color:var(--muted-foreground);`,
                      )}
                    >
                      <MagnifyingGlass
                        size={14}
                        weight="regular"
                        aria-hidden="true"
                      />
                    </span>
                    {`Search agents by name…`}
                  </span>
                  <span
                    style={css(
                      `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                    )}
                  >
                    <Funnel size={14} weight="regular" aria-hidden="true" />
                    {`Filter`}
                  </span>
                </div>
                <div style={css(`min-width:400px;`)}>
                  <div
                    role={`row`}
                    style={css(
                      `display:grid;gap:12px;grid-template-columns:minmax(160px,2fr) minmax(96px,1fr) 96px 24px;border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);margin-bottom:4px;padding:8px 0;font:500 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                    )}
                  >
                    <span>{`Agent`}</span>
                    <span>{`Created by`}</span>
                    <span>{`Last active`}</span>
                    <span
                      style={css(
                        `position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);`,
                      )}
                    ></span>
                  </div>
                  {agentRows.map((a, index5) => (
                    <Fragment key={index5}>
                      <div
                        role={`button`}
                        onClick={a.open}
                        style={css(
                          `display:grid;width:calc(100% + 24px);margin:0 -12px;padding:13px 12px;align-items:center;gap:12px;grid-template-columns:minmax(160px,2fr) minmax(96px,1fr) 96px 24px;border-radius:6px;cursor:default;`,
                        )}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            a.open();
                          }
                        }}
                      >
                        <span
                          style={css(
                            `display:flex;min-width:0;align-items:center;gap:8px;`,
                          )}
                        >
                          <span style={css(a.chipStyle)}>
                            <Robot
                              size="62%"
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                          <span
                            style={css(
                              `display:flex;min-width:0;flex:1;flex-direction:column;gap:1px;`,
                            )}
                          >
                            <span
                              style={css(
                                `display:flex;min-width:0;align-items:center;gap:6px;`,
                              )}
                            >
                              <span
                                style={css(
                                  `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 14px/18px var(--font-sans);color:var(--foreground);`,
                                )}
                              >
                                {a.title}
                              </span>
                              {a.waiting && (
                                <>
                                  <span
                                    style={css(
                                      `flex:0 0 auto;border-radius:4px;background:var(--ag-colorWarningBg);padding:2px 6px;font:400 11px/1 var(--font-sans);color:var(--ag-colorWarningText);`,
                                    )}
                                  >{`1 waiting`}</span>
                                </>
                              )}
                            </span>
                            <span
                              style={css(
                                `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/16px var(--font-sans);color:var(--muted-foreground);`,
                              )}
                            >
                              {a.desc}
                            </span>
                          </span>
                        </span>
                        <span
                          style={css(
                            `display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                          )}
                        >{`Mahmoud`}</span>
                        <span
                          style={css(
                            `display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--placeholder);`,
                          )}
                        >
                          {a.when}
                        </span>
                        <span
                          style={css(`display:flex;justify-content:flex-end;`)}
                        >
                          <span
                            style={css(
                              `display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                            )}
                          >
                            <DotsThree
                              size={16}
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                        </span>
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
          {view.automations && (
            <>
              {noAutomation && (
                <>
                  <div
                    style={css(
                      `box-sizing:border-box;flex:0 0 auto;padding:56px 64px 12px;`,
                    )}
                  >
                    <div
                      style={css(
                        `display:flex;min-width:0;align-items:center;gap:8px;`,
                      )}
                    >
                      <h3
                        style={css(
                          `margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 24px/1.3333 var(--font-sans);color:var(--foreground);`,
                        )}
                      >{`Automations`}</h3>
                      <span
                        style={css(
                          `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);`,
                        )}
                      >
                        <Plus size={14} weight="regular" aria-hidden="true" />
                        {`New automation`}
                      </span>
                    </div>
                  </div>
                  <div
                    style={css(
                      `min-width:0;padding:12px 64px 48px;flex:1;min-height:0;overflow-y:auto;`,
                    )}
                  >
                    <div
                      style={css(
                        `margin-bottom:12px;display:flex;align-items:center;gap:8px;`,
                      )}
                    >
                      <span
                        style={css(
                          `display:inline-flex;min-width:0;max-width:340px;flex:1;height:32px;align-items:center;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--placeholder);background:transparent;`,
                        )}
                      >
                        <span
                          style={css(
                            `display:inline-flex;color:var(--muted-foreground);`,
                          )}
                        >
                          <MagnifyingGlass
                            size={14}
                            weight="regular"
                            aria-hidden="true"
                          />
                        </span>
                        {`Search automations`}
                      </span>
                      <span
                        style={css(
                          `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                        )}
                      >
                        <Funnel size={14} weight="regular" aria-hidden="true" />
                        {`Filter`}
                      </span>
                    </div>
                    <div
                      className={`ag-scroll-x`}
                      style={css(
                        `overflow-x:auto;margin:0 -12px;padding:0 12px;`,
                      )}
                    >
                      <div style={css(`min-width:680px;`)}>
                        <div
                          role={`row`}
                          style={css(
                            `display:grid;gap:12px;grid-template-columns:minmax(140px,2fr) minmax(100px,0.8fr) minmax(130px,1fr) minmax(110px,0.9fr) minmax(120px,1fr) 24px;border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);margin-bottom:4px;padding:8px 0;font:500 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                          )}
                        >
                          <span>{`Automation`}</span>
                          <span>{`Status`}</span>
                          <span>{`Runs when`}</span>
                          <span>{`Last run`}</span>
                          <span>{`Agent`}</span>
                          <span
                            style={css(
                              `position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);`,
                            )}
                          ></span>
                        </div>
                        {automationRows.map((r, index7) => (
                          <Fragment key={index7}>
                            <div
                              role={`button`}
                              onClick={r.open}
                              style={css(
                                `display:grid;width:calc(100% + 24px);margin:0 -12px;padding:13px 12px;align-items:center;gap:12px;grid-template-columns:minmax(140px,2fr) minmax(100px,0.8fr) minmax(130px,1fr) minmax(110px,0.9fr) minmax(120px,1fr) 24px;border-radius:6px;cursor:default;`,
                              )}
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  r.open();
                                }
                              }}
                            >
                              <span
                                style={css(
                                  `display:flex;min-width:0;align-items:center;gap:8px;`,
                                )}
                              >
                                <span style={css(r.kindStyle)}>
                                  {r.isEvent && (
                                    <>
                                      <Lightning
                                        size={15}
                                        weight="regular"
                                        aria-hidden="true"
                                      />
                                    </>
                                  )}
                                  {r.isSchedule && (
                                    <>
                                      <ClockCounterClockwise
                                        size={15}
                                        weight="regular"
                                        aria-hidden="true"
                                      />
                                    </>
                                  )}
                                </span>
                                <span
                                  style={css(
                                    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/20px var(--font-sans);color:var(--foreground);`,
                                  )}
                                >
                                  {r.name}
                                </span>
                              </span>
                              <span
                                style={css(
                                  `display:flex;min-width:0;align-items:center;gap:7px;`,
                                )}
                              >
                                <span
                                  style={css(
                                    `width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:${r.statusColor};`,
                                  )}
                                ></span>
                                <span
                                  style={css(
                                    `font:400 13px/18px var(--font-sans);color:${r.statusColor};`,
                                  )}
                                >
                                  {r.statusLabel}
                                </span>
                              </span>
                              <span
                                style={css(
                                  `display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                                )}
                              >
                                {r.runsWhen}
                              </span>
                              <span
                                style={css(
                                  `display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                                )}
                              >
                                {r.lastRun}
                              </span>
                              <span
                                style={css(
                                  `display:flex;min-width:0;align-items:center;gap:6px;`,
                                )}
                              >
                                <span style={css(r.agentChipStyle)}>
                                  {r.agentInitials}
                                </span>
                                <span
                                  style={css(
                                    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                                  )}
                                >
                                  {r.agent}
                                </span>
                              </span>
                              <span
                                style={css(
                                  `display:flex;justify-content:flex-end;`,
                                )}
                              >
                                <span
                                  style={css(
                                    `display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                                  )}
                                >
                                  <DotsThree
                                    size={16}
                                    weight="regular"
                                    aria-hidden="true"
                                  />
                                </span>
                              </span>
                            </div>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
              {hasAutomation && this.state.historyOpen && (
                <AutomationHistory
                  key={au.name}
                  automation={au}
                  empty={this.props.emptyHistory}
                  onBack={() => this.setState({ historyOpen: false })}
                />
              )}
              {hasAutomation && !this.state.historyOpen && (
                <>
                  <div
                    style={css(
                      `margin:0 auto;width:100%;max-width:760px;flex:0 0 auto;padding:30px 32px 14px;box-sizing:border-box;`,
                    )}
                  >
                    <button
                      type={`button`}
                      onClick={closeAutomation}
                      style={css(
                        `display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;cursor:default;padding:0;font:400 13px/1 var(--font-sans);color:var(--muted-foreground);`,
                      )}
                    >
                      <ArrowLeft
                        size={14}
                        weight="regular"
                        aria-hidden="true"
                      />
                      {`Automations`}
                    </button>
                  </div>
                  <div style={css(`flex:1;min-height:0;overflow-y:auto;`)}>
                    <div
                      style={css(
                        `margin:0 auto;display:flex;width:100%;max-width:760px;flex-direction:column;padding:0 32px 70px;box-sizing:border-box;`,
                      )}
                    >
                      <div
                        style={css(
                          `display:flex;min-width:0;align-items:flex-start;gap:8px;`,
                        )}
                      >
                        <div
                          style={css(
                            `display:flex;min-width:0;flex-direction:column;`,
                          )}
                        >
                          <span
                            style={css(
                              `display:flex;min-width:0;align-items:center;margin-left:-8px;padding:4px 8px;border-radius:8px;`,
                            )}
                          >
                            <h3
                              style={css(
                                `margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 18px/1.25 var(--font-sans);letter-spacing:-0.02em;color:var(--foreground);`,
                              )}
                            >
                              {au.name}
                            </h3>
                          </span>
                          <p
                            style={css(
                              `margin:6px 0 0;font:400 14px/1.375 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {au.desc}
                          </p>
                        </div>
                        <span
                          style={css(
                            `margin-left:auto;display:flex;flex:0 0 auto;align-items:center;gap:6px;`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 12px;background:transparent;color:var(--foreground);font:400 14px/1 var(--font-sans);white-space:nowrap;`,
                            )}
                          >{`Test run`}</span>
                          <span
                            style={css(
                              `display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                            )}
                          >
                            <DotsThree
                              size={16}
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                        </span>
                      </div>
                      <div
                        style={css(
                          `margin:16px 0 4px;display:flex;min-width:0;flex-wrap:wrap;align-items:center;gap:14px;`,
                        )}
                      >
                        <span
                          style={css(
                            `display:inline-flex;align-items:center;gap:8px;font:400 13px/1 var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `position:relative;display:inline-block;width:32px;height:18px;border-radius:999px;background:var(--primary);`,
                            )}
                          >
                            <span
                              style={css(
                                `position:absolute;top:2px;left:16px;width:14px;height:14px;border-radius:50%;background:var(--primary-foreground);`,
                              )}
                            ></span>
                          </span>
                          {`On`}
                        </span>
                        <span
                          style={css(
                            `display:flex;min-width:0;align-items:center;gap:14px;`,
                          )}
                        >
                          <span
                            style={css(
                              `display:block;height:16px;width:1px;flex:0 0 auto;background:var(--border);`,
                            )}
                          ></span>
                          <span
                            style={css(
                              `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/1 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >{`Runs ${au.agent} · edited ${au.edited}`}</span>
                        </span>
                      </div>
                      <div
                        style={css(
                          `margin-top:26px;display:flex;flex-direction:column;gap:22px;`,
                        )}
                      >
                        <div
                          style={css(
                            `display:flex;flex-direction:column;gap:7px;`,
                          )}
                        >
                          <span
                            style={css(
                              `font:500 13px/18px var(--font-sans);color:var(--foreground);`,
                            )}
                          >{`Agent`}</span>
                          <span
                            style={css(
                              `display:flex;height:36px;width:100%;align-items:center;justify-content:space-between;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 12px;font:400 14px/1 var(--font-sans);color:var(--foreground);background:transparent;box-sizing:border-box;`,
                            )}
                          >
                            <span
                              style={css(
                                `display:flex;min-width:0;flex:1;align-items:center;gap:8px;`,
                              )}
                            >
                              <span style={css(au.agentChipStyle)}>
                                {au.agentInitials}
                              </span>
                              <span
                                style={css(
                                  `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                                )}
                              >
                                {au.agent}
                              </span>
                            </span>
                            <span
                              style={css(
                                `display:inline-flex;color:var(--placeholder);`,
                              )}
                            >
                              <CaretDown
                                size={12}
                                weight="regular"
                                aria-hidden="true"
                              />
                            </span>
                          </span>
                          <span
                            style={css(
                              `font:400 12px/1.375 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {au.agentHelper}
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;flex-direction:column;gap:7px;`,
                          )}
                        >
                          <span
                            style={css(
                              `font:500 13px/18px var(--font-sans);color:var(--foreground);`,
                            )}
                          >{`Runs when`}</span>
                          <span
                            style={css(
                              `display:flex;height:36px;width:100%;align-items:center;justify-content:space-between;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 12px;font:400 14px/1 var(--font-sans);color:var(--foreground);background:transparent;box-sizing:border-box;`,
                            )}
                          >
                            <span
                              style={css(
                                `display:flex;min-width:0;flex:1;align-items:center;gap:8px;`,
                              )}
                            >
                              <span
                                style={css(
                                  `display:inline-flex;flex:0 0 auto;color:var(--muted-foreground);`,
                                )}
                              >
                                {au.isEvent && (
                                  <>
                                    <Lightning
                                      size={14}
                                      weight="regular"
                                      aria-hidden="true"
                                    />
                                  </>
                                )}
                                {au.isSchedule && (
                                  <>
                                    <CalendarBlank
                                      size={14}
                                      weight="regular"
                                      aria-hidden="true"
                                    />
                                  </>
                                )}
                              </span>
                              <span
                                style={css(
                                  `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                                )}
                              >
                                {au.runsWhen}
                              </span>
                            </span>
                            <span
                              style={css(
                                `display:inline-flex;color:var(--placeholder);`,
                              )}
                            >
                              <CaretDown
                                size={12}
                                weight="regular"
                                aria-hidden="true"
                              />
                            </span>
                          </span>
                          <span
                            style={css(
                              `font:400 12px/1.375 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {au.runsHelper}
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;flex-direction:column;gap:7px;`,
                          )}
                        >
                          <span
                            style={css(
                              `font:500 13px/18px var(--font-sans);color:var(--foreground);`,
                            )}
                          >{`Instruction`}</span>
                          <div
                            style={css(
                              `min-height:88px;border-radius:6px;border:1px solid var(--input);padding:10px 12px;font:400 14px/1.5 var(--font-sans);color:var(--foreground);box-sizing:border-box;`,
                            )}
                          >
                            {au.instruction}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => this.setState({ historyOpen: true })}
                        type={`button`}
                        style={css(
                          `margin-top:30px;display:flex;width:100%;cursor:default;align-items:center;gap:12px;border-radius:8px;border:1px solid var(--border);background:transparent;padding:10px 14px;text-align:left;`,
                        )}
                      >
                        <span
                          style={css(
                            `display:flex;width:28px;height:28px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:6px;background:var(--muted);color:var(--muted-foreground);`,
                          )}
                        >
                          <ClockCounterClockwise
                            size={15}
                            weight="regular"
                            aria-hidden="true"
                          />
                        </span>
                        <span
                          style={css(
                            `display:flex;min-width:0;flex:1;flex-direction:column;`,
                          )}
                        >
                          <span
                            style={css(
                              `font:500 14px/20px var(--font-sans);color:var(--foreground);`,
                            )}
                          >{`Run history`}</span>
                          <span
                            style={css(
                              `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {au.runsCaption}
                          </span>
                        </span>
                        <span
                          style={css(
                            `display:inline-flex;flex:0 0 auto;color:var(--muted-foreground);`,
                          )}
                        >
                          <CaretRight
                            size={14}
                            weight="regular"
                            aria-hidden="true"
                          />
                        </span>
                      </button>
                      <div
                        style={css(
                          `margin-top:30px;display:flex;align-items:center;justify-content:flex-end;gap:10px;border-top:1px solid var(--border);padding-top:20px;`,
                        )}
                      >
                        <span
                          style={css(
                            `display:inline-flex;height:32px;align-items:center;border-radius:6px;border:1px solid var(--border);padding:0 12px;font:400 14px/1 var(--font-sans);color:var(--foreground);opacity:.5;`,
                          )}
                        >{`Discard`}</span>
                        <span
                          style={css(
                            `display:inline-flex;height:32px;align-items:center;border-radius:6px;background:var(--primary);color:var(--primary-foreground);padding:0 12px;font:400 14px/1 var(--font-sans);opacity:.5;`,
                          )}
                        >{`Save`}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
          {view.skills && (
            <div
              style={css(
                `display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden;`,
              )}
            >
              {hasSkill ? (
                <div
                  key={sk.title}
                  className={`ag-skill-page`}
                  style={css(
                    `box-sizing:border-box;display:flex;flex:1;min-height:0;flex-direction:column;gap:16px;padding:32px 64px 24px;overflow-y:auto;`,
                  )}
                >
                  <div
                    style={css(`display:flex;flex-direction:column;gap:8px;`)}
                  >
                    <button
                      type={`button`}
                      aria-label="Back to skills"
                      onClick={closeSkill}
                      style={css(
                        `display:inline-flex;align-self:flex-start;align-items:center;gap:4px;border:0;padding:0;background:transparent;font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                      )}
                    >
                      <CaretLeft
                        size={12}
                        weight="regular"
                        aria-hidden="true"
                      />
                      {`Skills`}
                    </button>
                    <div
                      style={css(
                        `display:flex;min-width:0;align-items:center;gap:8px;`,
                      )}
                    >
                      <h3
                        className={`ag-skill-title`}
                        style={css(
                          `margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 24px/1.3333 var(--font-sans);color:var(--foreground);`,
                        )}
                      >
                        {sk.title}
                      </h3>
                      <span
                        style={css(
                          `display:inline-flex;height:32px;align-items:center;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);opacity:0.5;`,
                        )}
                      >{`Save`}</span>
                      <span
                        aria-hidden="true"
                        style={css(
                          `display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                        )}
                      >
                        <DotsThree size={18} weight="bold" />
                      </span>
                    </div>
                    <span
                      style={css(
                        `font:400 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                      )}
                    >
                      {`Used by `}
                      <span style={css(`color:var(--foreground);`)}>
                        {sk.usedByLabel}
                      </span>
                      {` · Edited ${sk.age}`}
                    </span>
                  </div>
                  <div
                    className={`ag-skill-page-body`}
                    style={css(`display:flex;flex:1;min-height:0;gap:20px;`)}
                  >
                    <div
                      style={css(
                        `display:flex;min-width:0;flex:1;flex-direction:column;gap:8px;`,
                      )}
                    >
                      <span style={css(SKILL_LABEL)}>{`Description`}</span>
                      <div style={css(`${SKILL_BOX}padding:10px 12px;`)}>
                        {sk.desc}
                      </div>
                      <span style={css(`${SKILL_LABEL}margin-top:8px;`)}>
                        {`Instructions`}
                      </span>
                      <div
                        style={css(
                          `${SKILL_BOX}flex:1;min-height:180px;padding:12px 14px;overflow-y:auto;`,
                        )}
                      >
                        {renderSkillMarkdown(sk.md)}
                      </div>
                    </div>
                    <div
                      className={`ag-skill-files`}
                      style={css(
                        `display:flex;width:260px;flex:0 0 auto;flex-direction:column;gap:8px;`,
                      )}
                    >
                      <span style={css(SKILL_LABEL)}>{`Files`}</span>
                      <div
                        style={css(
                          `${SKILL_BOX}display:flex;flex:1;flex-direction:column;padding:6px;`,
                        )}
                      >
                        {["SKILL.md", ...sk.files].map((file, index8) => (
                          <span
                            key={file}
                            style={css(
                              `display:flex;align-items:center;gap:8px;border-radius:6px;padding:6px 8px;font:400 13px/18px var(--font-sans);color:var(--foreground);${index8 === 0 ? "background:var(--accent);font-weight:500;" : ""}`,
                            )}
                          >
                            <FileText
                              size={14}
                              weight="regular"
                              aria-hidden="true"
                              style={css(
                                `flex:0 0 auto;color:var(--muted-foreground);`,
                              )}
                            />
                            <span
                              style={css(
                                `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                              )}
                            >
                              {file}
                            </span>
                          </span>
                        ))}
                        <span style={css(`flex:1;`)}></span>
                        <span
                          style={css(
                            `display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);margin:6px -6px -6px;padding:10px 14px;`,
                          )}
                        >
                          <span
                            style={css(
                              `display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;`,
                            )}
                          >
                            <span
                              style={css(
                                `font:500 13px/18px var(--font-sans);color:var(--foreground);`,
                              )}
                            >{`Let files run as programs`}</span>
                            <span
                              style={css(
                                `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);`,
                              )}
                            >{`Your sandbox must allow it too.`}</span>
                          </span>
                          <span aria-hidden="true" style={css(SKILL_SWITCH)}>
                            <span style={css(SKILL_SWITCH_THUMB)}></span>
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={css(
                      `box-sizing:border-box;flex:0 0 auto;display:flex;flex-direction:column;gap:12px;padding:56px 64px 12px;`,
                    )}
                  >
                    <div
                      style={css(`display:flex;flex-direction:column;gap:4px;`)}
                    >
                      <div
                        style={css(
                          `display:flex;min-width:0;align-items:center;gap:8px;`,
                        )}
                      >
                        <h3
                          style={css(
                            `margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 24px/1.3333 var(--font-sans);color:var(--foreground);`,
                          )}
                        >{`Skills`}</h3>
                        <span
                          style={css(
                            `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);`,
                          )}
                        >
                          <Plus size={14} weight="regular" aria-hidden="true" />
                          {`New skill`}
                        </span>
                      </div>
                      <span
                        className={`ag-skill-intro`}
                        style={css(
                          `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/20px var(--font-sans);color:var(--muted-foreground);`,
                        )}
                      >{`A skill teaches an agent how to do one job well. Add it once, then use it in any agent.`}</span>
                    </div>
                    <div
                      style={css(
                        `display:flex;min-width:0;align-items:center;gap:8px;`,
                      )}
                    >
                      <span
                        style={css(
                          `display:inline-flex;min-width:0;flex:1;max-width:320px;height:32px;align-items:center;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--placeholder);`,
                        )}
                      >
                        <MagnifyingGlass
                          size={14}
                          weight="regular"
                          aria-hidden="true"
                          style={css(
                            `flex:0 0 auto;color:var(--muted-foreground);`,
                          )}
                        />
                        <span
                          style={css(
                            `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                          )}
                        >{`Search skills`}</span>
                      </span>
                      <span
                        style={css(
                          `display:inline-flex;height:32px;flex:0 0 auto;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);`,
                        )}
                      >
                        <Funnel size={14} weight="regular" aria-hidden="true" />
                        {`Filter`}
                      </span>
                      <span style={css(`flex:1;`)}></span>
                      <span
                        className={`ag-skill-archived`}
                        style={css(
                          `display:inline-flex;flex:0 0 auto;align-items:center;gap:8px;font:400 13px/1 var(--font-sans);color:var(--muted-foreground);`,
                        )}
                      >
                        <span aria-hidden="true" style={css(SKILL_SWITCH)}>
                          <span style={css(SKILL_SWITCH_THUMB)}></span>
                        </span>
                        {`Show archived`}
                      </span>
                    </div>
                  </div>
                  <div
                    style={css(
                      `min-height:0;min-width:0;flex:1;overflow-y:auto;padding:4px 64px 24px;`,
                    )}
                  >
                    <div
                      role={`row`}
                      className={`ag-skill-grid`}
                      style={css(
                        `border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);padding:8px 0;font:500 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                      )}
                    >
                      <span></span>
                      <span>{`Name`}</span>
                      <span className={`ag-skill-wide`}>{`Used by`}</span>
                      <span className={`ag-skill-wide`}>{`Created by`}</span>
                      <span
                        className={`ag-skill-age`}
                        style={css(`text-align:right;`)}
                      >
                        {`Last edited`}
                      </span>
                      <span></span>
                    </div>
                    {skillSections.map((sec, index5) => (
                      <section key={index5}>
                        <h2
                          style={css(
                            `display:flex;align-items:center;gap:6px;margin:0;padding:14px 0 6px;font:500 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <CaretDown
                            size={12}
                            weight="regular"
                            aria-hidden="true"
                            style={css(`color:var(--muted-foreground);`)}
                          />
                          {sec.label}
                          <span
                            style={css(
                              `font-weight:400;font-variant-numeric:tabular-nums;color:var(--muted-foreground);`,
                            )}
                          >
                            {sec.count}
                          </span>
                        </h2>
                        {sec.skills.map((k) => (
                          <div
                            key={k.title}
                            role={`button`}
                            tabIndex={0}
                            onClick={k.open}
                            onKeyDown={(event) =>
                              event.key === "Enter" && k.open()
                            }
                            className={`ag-skill-grid ag-skill-row`}
                            style={css(
                              `width:calc(100% + 24px);margin:0 -12px;padding:10px 12px;align-items:center;border-radius:6px;cursor:default;`,
                            )}
                          >
                            <span
                              aria-hidden="true"
                              style={css(
                                `box-sizing:border-box;display:flex;width:32px;height:32px;align-items:center;justify-content:center;border-radius:9px;border:1px solid var(--border);background:var(--muted);color:var(--muted-foreground);`,
                              )}
                            >
                              <Compass size={16} weight="regular" />
                            </span>
                            <span
                              style={css(
                                `display:flex;min-width:0;flex-direction:column;gap:2px;`,
                              )}
                            >
                              <span
                                style={css(`${SKILL_CELL}font-weight:600;`)}
                              >
                                {k.title}
                              </span>
                              <span
                                style={css(
                                  `${SKILL_CELL}color:var(--muted-foreground);`,
                                )}
                              >
                                {k.desc}
                              </span>
                            </span>
                            <span
                              className={`ag-skill-wide`}
                              style={css(SKILL_CELL)}
                            >
                              {k.usedByLabel}
                            </span>
                            <span
                              className={`ag-skill-wide`}
                              style={css(SKILL_CELL)}
                            >
                              {k.createdBy}
                            </span>
                            <span
                              className={`ag-skill-age`}
                              style={css(
                                `${SKILL_CELL}text-align:right;color:var(--muted-foreground);`,
                              )}
                            >
                              {k.age}
                            </span>
                            <span
                              aria-hidden="true"
                              style={css(
                                `display:flex;justify-content:flex-end;color:var(--muted-foreground);`,
                              )}
                            >
                              <DotsThree size={16} weight="bold" />
                            </span>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {view.sessions && (
            <>
              <div
                style={css(
                  `box-sizing:border-box;flex:0 0 auto;padding:56px 64px 12px;`,
                )}
              >
                <div
                  style={css(
                    `display:flex;min-width:0;align-items:center;gap:8px;`,
                  )}
                >
                  <h3
                    style={css(
                      `margin:0;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 24px/1.3333 var(--font-sans);color:var(--foreground);`,
                    )}
                  >{`Sessions`}</h3>
                </div>
              </div>
              <div
                style={css(
                  `min-width:0;padding:12px 64px 48px;flex:1;min-height:0;overflow-y:auto;`,
                )}
              >
                <div
                  style={css(
                    `margin-bottom:12px;display:flex;align-items:center;gap:8px;`,
                  )}
                >
                  <span
                    style={css(
                      `display:inline-flex;min-width:0;max-width:340px;flex:1;height:32px;align-items:center;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--placeholder);background:transparent;`,
                    )}
                  >
                    <span
                      style={css(
                        `display:inline-flex;color:var(--muted-foreground);`,
                      )}
                    >
                      <MagnifyingGlass
                        size={14}
                        weight="regular"
                        aria-hidden="true"
                      />
                    </span>
                    {`Search sessions`}
                  </span>
                  <span
                    style={css(
                      `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                    )}
                  >
                    <Funnel size={14} weight="regular" aria-hidden="true" />
                    {`Filter`}
                  </span>
                </div>
                <div style={css(`min-width:400px;`)}>
                  <div
                    role={`row`}
                    style={css(
                      `display:grid;gap:12px;grid-template-columns:minmax(160px,2fr) minmax(120px,1fr) 96px 24px;border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent);margin-bottom:4px;padding:8px 0;font:500 13px/18px var(--font-sans);color:var(--muted-foreground);`,
                    )}
                  >
                    <span>{`Session`}</span>
                    <span>{`Agent`}</span>
                    <span>{`Last activity`}</span>
                    <span
                      style={css(
                        `position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);`,
                      )}
                    ></span>
                  </div>
                  {sessionRows.map((r, index5) => (
                    <Fragment key={index5}>
                      <div
                        role={`button`}
                        onClick={r.open}
                        style={css(
                          `display:grid;width:calc(100% + 24px);margin:0 -12px;padding:13px 12px;align-items:center;gap:12px;grid-template-columns:minmax(160px,2fr) minmax(120px,1fr) 96px 24px;border-radius:6px;cursor:default;`,
                        )}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            r.open();
                          }
                        }}
                      >
                        <span
                          style={css(
                            `display:flex;min-width:0;align-items:center;gap:10px;`,
                          )}
                        >
                          <span
                            style={css(
                              `position:relative;display:flex;flex:0 0 auto;align-items:center;color:var(--muted-foreground);`,
                            )}
                          >
                            {r.auto ? (
                              <Clock
                                size={18}
                                weight="regular"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChatCircle
                                size={18}
                                weight="regular"
                                aria-hidden="true"
                              />
                            )}
                            <span
                              style={css(
                                `position:absolute;top:-1px;right:-2px;width:8px;height:8px;border-radius:50%;border:1px solid var(--background);background:${r.dot};`,
                              )}
                            ></span>
                          </span>
                          <span
                            style={css(
                              `display:flex;min-width:0;flex:1;flex-direction:column;gap:1px;`,
                            )}
                          >
                            <span
                              style={css(
                                `display:flex;min-width:0;align-items:center;gap:6px;`,
                              )}
                            >
                              <span
                                style={css(
                                  `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 14px/18px var(--font-sans);color:var(--foreground);`,
                                )}
                              >
                                {r.name ?? r.ask}
                              </span>
                              {r.waiting && (
                                <>
                                  <span
                                    style={css(
                                      `flex:0 0 auto;border-radius:4px;background:var(--ag-colorWarningBg);padding:2px 6px;font:400 11px/1 var(--font-sans);color:var(--ag-colorWarningText);`,
                                    )}
                                  >{`Approval`}</span>
                                </>
                              )}
                            </span>
                            <span
                              style={css(
                                `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/16px var(--font-sans);color:var(--muted-foreground);`,
                              )}
                            >
                              {r.reply}
                            </span>
                          </span>
                        </span>
                        <span
                          style={css(
                            `display:flex;min-width:0;align-items:center;gap:6px;`,
                          )}
                        >
                          <span style={css(r.smallChipStyle)}>
                            <Robot
                              size="62%"
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                          <span
                            style={css(
                              `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                            )}
                          >
                            {r.title}
                          </span>
                        </span>
                        <span
                          style={css(
                            `display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--placeholder);`,
                          )}
                        >
                          {r.when}
                        </span>
                        <span
                          style={css(`display:flex;justify-content:flex-end;`)}
                        >
                          <span
                            style={css(
                              `display:inline-flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                            )}
                          >
                            <DotsThree
                              size={16}
                              weight="regular"
                              aria-hidden="true"
                            />
                          </span>
                        </span>
                      </div>
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
          {view.playground && (
            // Same layout as the hero session (.r3-* classes in landing/hero.css).
            <div className="r3-aw-main" style={css(`flex:1;min-height:0;`)}>
              <div className="r3-pf-top">
                <span className="r3-pf-agent">
                  <span className="r3-pf-aico">
                    <CalendarBlank
                      size={14}
                      weight="regular"
                      aria-hidden="true"
                    />
                  </span>
                  <b>{ss.title}</b>
                </span>
              </div>
              <div className="ws-split" data-config={configOpen}>
              {configOpen && (
                <PlaygroundSettings
                  key={ss.title}
                  agent={ss}
                  onHide={toggleConfig}
                />
              )}
              <div className="ws-chat">
              {!configOpen && (
                <button
                  type="button"
                  className="ws-cfg-show"
                  aria-label="Show configuration"
                  onClick={toggleConfig}
                >
                  <CaretDoubleRight size={14} weight="regular" aria-hidden="true" />
                </button>
              )}
              <div className="r3-ap-thread" style={css(`overflow-y:auto;`)}>
                <div className="r3-ap-user">
                  <p>{ss.ask}</p>
                </div>
                {/* Collapsed by default, like a finished run in the product. */}
                <div className="r3-ap-worked r3-hx-wk">
                  <button
                    type="button"
                    className="ws-worked"
                    aria-expanded={this.state.stepsFor === ss.ask}
                    onClick={() =>
                      this.setState((state) => ({
                        stepsFor: state.stepsFor === ss.ask ? null : ss.ask,
                      }))
                    }
                  >
                    {ss.worked}
                    <CaretDown size={13} weight="regular" aria-hidden="true" />
                  </button>
                </div>
                {this.state.stepsFor === ss.ask && (
                  <div className="r3-ap-tl r3-hx-tl">
                    {ss.steps.map((st, index11) => (
                      <div className="r3-ap-step" key={index11}>
                        <span className="r3-ap-node">
                          <span>
                            <span style={css(st.logoStyle)}></span>
                          </span>
                        </span>
                        <span className="r3-ap-st">
                          {`${st.pre} `}
                          <b>{st.bold}</b>
                          {st.post ? ` ${st.post}` : ""}
                        </span>
                        <span className="r3-ap-c">
                          <CaretDown
                            size={13}
                            weight="regular"
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="r3-ap-prose">
                  <p>{ss.reply}</p>
                </div>
              </div>
              <div className="r3-ap-comp r3-hx-comp">
                <div className="r3-hx-field">
                  <span className="r3-hx-ph">Ask the agent…</span>
                </div>
                <div>
                  <Microphone size={16} weight="regular" aria-hidden="true" />
                  <Paperclip size={16} weight="regular" aria-hidden="true" />
                  <span className="r3-ap-send">
                    <ArrowUp size={14} weight="bold" aria-hidden="true" />
                  </span>
                </div>
              </div>
              </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}
