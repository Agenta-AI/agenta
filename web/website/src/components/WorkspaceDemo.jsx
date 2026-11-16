import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarBlank,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretRight,
  ChatCircle,
  ChatsCircle,
  Clock,
  Check,
  ClockCounterClockwise,
  Copy,
  Cpu,
  DotsThree,
  FileText,
  Funnel,
  GearSix,
  GraduationCap,
  House,
  Lightning,
  Paperclip,
  Microphone,
  ListBullets,
  MagnifyingGlass,
  Plugs,
  Plus,
  PuzzlePiece,
  Robot,
  ShieldCheck,
  SidebarSimple,
  SquaresFour,
  Wrench,
  X,
} from "@phosphor-icons/react";
import AutomationHistory from "./workspace-demo/AutomationHistory.jsx";
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

const SAMPLE_NAMES = ["Alex", "Sam", "Jordan", "Taylor", "Casey"];

export default class WorkspaceDemo extends Component {
  componentDidMount() {
    document.addEventListener("keydown", this.onEscape);
    // The landing hero's static sidebar asks for a screen with this event;
    // a click made before hydration waits in window.__agDemoGo.
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
      this.frame?.querySelector('[aria-label="Close skill details"]')?.focus();
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
      this.props.onLive ?? this.onLive,
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
        <div
          className={`ag-app-side`}
          style={css(
            `display:flex;flex-direction:column;min-width:0;background:var(--ag-sidebar-bg);border-right:1px solid var(--ag-shell-line);`,
          )}
        >
          <div
            style={css(
              `display:flex;height:32px;flex:0 0 auto;align-items:center;justify-content:space-between;margin:6px 0 4px 8px;padding:0 12px;`,
            )}
          >
            <img
              className={`th-light-only`}
              src={`/logos/Agenta-logo-full-light.svg`}
              alt={`Agenta`}
              style={css(`height:18px;display:block;`)}
            />
            <img
              className={`th-dark-only`}
              src={`/logos/Agenta-logo-full-dark.svg`}
              alt={`Agenta`}
              style={css(`height:18px;display:block;`)}
            />
            <button
              type="button"
              aria-label={
                this.state.sidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
              }
              aria-expanded={!this.state.sidebarCollapsed}
              onClick={() =>
                this.setState((state) => ({
                  sidebarCollapsed: !state.sidebarCollapsed,
                }))
              }
              style={css(
                `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border:0;background:transparent;border-radius:6px;color:var(--muted-foreground);`,
              )}
            >
              <SidebarSimple size={16} weight="regular" aria-hidden="true" />
            </button>
          </div>
          <nav
            style={css(
              `display:flex;flex-direction:column;padding-top:4px;min-height:0;flex:1;`,
            )}
            aria-label="Demo workspace"
          >
            <button
              type={`button`}
              aria-label="Home"
              onClick={nav.home.go}
              style={css(nav.home.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <House size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Home`}</span>
            </button>
            <button
              type={`button`}
              aria-label="Agents"
              onClick={nav.agents.go}
              style={css(nav.agents.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <Robot size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Agents`}</span>
            </button>
            <button
              type={`button`}
              aria-label="Automations"
              onClick={nav.automations.go}
              style={css(nav.automations.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <Lightning size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Automations`}</span>
            </button>
            <button
              type={`button`}
              aria-label="Skills"
              onClick={nav.skills.go}
              style={css(nav.skills.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <PuzzlePiece size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Skills`}</span>
            </button>
            <div
              style={css(
                `position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:default;text-align:left;color:var(--foreground);padding-right:0;`,
              )}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  nav.sessions.go();
                }
              }}
              aria-label="Sessions"
              onClick={nav.sessions.go}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <ChatsCircle size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Sessions`}</span>
            </div>
            <div
              style={css(
                `display:flex;flex:1 1 0;flex-direction:column;min-height:0;overflow-y:auto;`,
              )}
            >
              {railGroups.map((g, index4) => (
                <Fragment key={index4}>
                  <button
                    type="button"
                    className="ag-demo-group-toggle"
                    aria-expanded={!this.state.closedGroups?.[g.agent]}
                    onClick={() =>
                      this.setState((state) => ({
                        closedGroups: {
                          ...state.closedGroups,
                          [g.agent]: !state.closedGroups?.[g.agent],
                        },
                      }))
                    }
                    style={css(
                      `margin:0 auto;display:flex;width:calc(100% - 16px);flex:0 0 auto;cursor:default;user-select:none;align-items:center;gap:4px;border-radius:6px;padding:8px 0 2px 12px;font:400 12px/16px var(--font-sans);color:var(--muted-foreground);`,
                    )}
                  >
                    <span
                      style={css(
                        `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                      )}
                    >
                      {g.agent}
                    </span>
                    <span
                      style={css(
                        `margin-right:4px;display:flex;width:22px;height:22px;flex:0 0 auto;align-items:center;justify-content:center;transform:rotate(${this.state.closedGroups?.[g.agent] ? 0 : 90}deg);`,
                      )}
                    >
                      <CaretRight
                        size={11}
                        weight="regular"
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  {!this.state.closedGroups?.[g.agent] &&
                    g.rows.map((r, index5) => (
                      <Fragment key={index5}>
                        <button
                          type={`button`}
                          onClick={r.open}
                          style={css(r.style)}
                        >
                          <span
                            style={css(
                              `display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:12px;color:${r.railDot};`,
                            )}
                          >
                            {r.auto && (
                              <>
                                <Lightning
                                  size={12}
                                  weight="regular"
                                  aria-hidden="true"
                                />
                              </>
                            )}
                            {r.chat && (
                              <>
                                <span
                                  style={css(
                                    `width:8px;height:8px;border-radius:50%;border:1.5px solid currentColor;background:${r.railFill};`,
                                  )}
                                ></span>
                              </>
                            )}
                          </span>
                          <span
                            style={css(
                              `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >
                            {r.name ?? r.ask}
                          </span>
                        </button>
                      </Fragment>
                    ))}
                </Fragment>
              ))}
            </div>
          </nav>
          <div
            style={css(
              `display:flex;flex-direction:column;flex:0 0 auto;padding-bottom:4px;`,
            )}
          >
            <a
              href="/marketplace"
              className="ag-demo-link"
              style={css(
                `position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:pointer;text-decoration:none;text-align:left;color:var(--foreground);`,
              )}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <SquaresFour size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Templates`}</span>
            </a>
            <div
              style={css(
                `position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:default;text-align:left;color:var(--foreground);`,
              )}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <GearSix size={16} weight="regular" aria-hidden="true" />
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Settings`}</span>
            </div>
            <div
              style={css(
                `display:flex;align-items:center;gap:8px;margin:4px 8px 8px;padding:6px 8px;border-radius:6px;border:1px solid var(--ag-shell-line);background:var(--background);`,
              )}
            >
              <span
                style={css(
                  `display:inline-flex;width:24px;height:24px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:6px;background:var(--primary);color:var(--primary-foreground);font:600 11px/1 var(--font-sans);`,
                )}
              >{`A`}</span>
              <span
                style={css(
                  `display:flex;min-width:0;flex:1;flex-direction:column;`,
                )}
              >
                <span
                  style={css(
                    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px/16px var(--font-sans);color:var(--foreground);`,
                  )}
                >{`Acme`}</span>
                <span
                  style={css(
                    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/14px var(--font-sans);color:var(--muted-foreground);`,
                  )}
                >{`Default project`}</span>
              </span>
            </div>
          </div>
        </div>
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
            <>
              <div
                style={css(
                  `position:relative;display:flex;flex:1;min-height:0;flex-direction:column;overflow:hidden;`,
                )}
              >
                <div
                  style={css(
                    `box-sizing:border-box;flex:0 0 auto;display:flex;flex-direction:column;gap:12px;padding:56px 64px 12px;`,
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
                    >{`Skills`}</h3>
                    <span
                      style={css(
                        `flex:0 0 auto;font:400 13px/1 var(--font-sans);color:var(--muted-foreground);`,
                      )}
                    >{`Archived skills`}</span>
                  </div>
                  <div
                    style={css(
                      `display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;`,
                    )}
                  >
                    <span
                      style={css(
                        `display:inline-flex;min-width:0;flex:1;max-width:320px;height:32px;align-items:center;gap:8px;border-radius:6px;border:1px solid var(--input);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--placeholder);`,
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
                      {`Search skills by name…`}
                    </span>
                    <span
                      style={css(
                        `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);`,
                      )}
                    >
                      <Plus size={14} weight="regular" aria-hidden="true" />
                      {`New skill`}
                    </span>
                  </div>
                </div>
                <div
                  style={css(
                    `min-height:0;min-width:0;flex:1;overflow-y:auto;padding:16px 64px 24px;display:flex;flex-direction:column;gap:24px;`,
                  )}
                >
                  {skillSections.map((sec, index5) => (
                    <Fragment key={index5}>
                      <section
                        style={css(
                          `display:flex;flex-direction:column;gap:10px;`,
                        )}
                      >
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:8px;`,
                          )}
                        >
                          <h2
                            style={css(
                              `margin:0;font:600 12px/16px var(--font-sans);letter-spacing:0.025em;text-transform:uppercase;color:var(--ag-colorTextSecondary);`,
                            )}
                          >
                            {sec.label}
                          </h2>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);font-variant-numeric:tabular-nums;color:var(--ag-colorTextTertiary);`,
                            )}
                          >
                            {sec.count}
                          </span>
                          {sec.tag && (
                            <>
                              <span
                                style={css(
                                  `border-radius:4px;background:var(--ag-colorFillTertiary);padding:1px 6px;font:400 10px/14px var(--font-sans);color:var(--ag-colorTextTertiary);`,
                                )}
                              >
                                {sec.tag}
                              </span>
                            </>
                          )}
                        </div>
                        <div
                          className={`ag-app-skills`}
                          style={css(
                            `display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;`,
                          )}
                        >
                          {sec.skills.map((k, index8) => (
                            <Fragment key={index8}>
                              <button
                                type={`button`}
                                onClick={k.open}
                                style={css(
                                  `box-sizing:border-box;display:flex;cursor:default;flex-direction:column;gap:8px;border-radius:8px;border:1px solid var(--ag-colorBorderSecondary);background:var(--ag-colorBgContainer);padding:12px;text-align:left;transition:border-color .15s;`,
                                )}
                              >
                                <span
                                  style={css(
                                    `display:flex;min-width:0;align-items:center;gap:8px;`,
                                  )}
                                >
                                  <span style={css(k.avatarStyle)}>
                                    {k.builtin && (
                                      <>
                                        <Lightning
                                          size={13}
                                          weight="regular"
                                          aria-hidden="true"
                                        />
                                      </>
                                    )}
                                    {k.project && <>{`sk`}</>}
                                  </span>
                                  <span
                                    style={css(
                                      `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/16px var(--font-sans);color:var(--ag-colorText);`,
                                    )}
                                  >
                                    {k.slug}
                                  </span>
                                </span>
                                <span
                                  style={css(
                                    `min-height:32px;font:400 12px/16px var(--font-sans);color:var(--ag-colorTextSecondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;`,
                                  )}
                                >
                                  {k.desc}
                                </span>
                                <span
                                  style={css(
                                    `display:flex;align-items:center;gap:6px;font:400 11px/14px var(--font-sans);color:var(--ag-colorTextTertiary);`,
                                  )}
                                >
                                  {k.meta}
                                </span>
                              </button>
                            </Fragment>
                          ))}
                        </div>
                      </section>
                    </Fragment>
                  ))}
                </div>
                {hasSkill && (
                  <>
                    <div
                      onClick={closeSkill}
                      style={css(
                        `position:absolute;inset:0;background:var(--ag-colorBgMask);`,
                      )}
                    ></div>
                    <div
                      className={`ag-app-drawer`}
                      style={css(
                        `position:absolute;top:0;right:0;bottom:0;width:min(560px,100%);display:flex;flex-direction:column;background:var(--background);border-left:1px solid var(--border);box-shadow:var(--ag-surface-inspector-shadow);`,
                      )}
                    >
                      <div
                        style={css(
                          `display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);`,
                        )}
                      >
                        <span style={css(sk.avatarStyle)}>
                          {sk.builtin && (
                            <>
                              <Lightning
                                size={13}
                                weight="regular"
                                aria-hidden="true"
                              />
                            </>
                          )}
                          {sk.project && <>{`sk`}</>}
                        </span>
                        <span
                          style={css(
                            `display:flex;min-width:0;flex:1;flex-direction:column;`,
                          )}
                        >
                          <span
                            style={css(
                              `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 14px/18px var(--font-sans);color:var(--foreground);`,
                            )}
                          >
                            {sk.slug}
                          </span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {sk.meta}
                          </span>
                        </span>
                        <span
                          style={css(
                            `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 12px;background:transparent;color:var(--foreground);font:400 14px/1 var(--font-sans);white-space:nowrap;`,
                          )}
                        >{`Edit`}</span>
                        <button
                          type={`button`}
                          aria-label="Close skill details"
                          onClick={closeSkill}
                          style={css(
                            `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;border:none;background:transparent;cursor:default;color:var(--muted-foreground);`,
                          )}
                        >
                          <X size={14} weight="regular" aria-hidden="true" />
                        </button>
                      </div>
                      <div
                        className={`ag-app-drawer-body`}
                        style={css(
                          `display:grid;grid-template-columns:minmax(0,1fr) 180px;flex:1;min-height:0;`,
                        )}
                      >
                        <div
                          style={css(
                            `display:flex;flex-direction:column;min-height:0;overflow-y:auto;`,
                          )}
                        >
                          <div
                            style={css(
                              `padding:14px 16px 6px;font:400 13px/1.45 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {sk.desc}
                          </div>
                          <div
                            style={css(
                              `display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);`,
                            )}
                          >
                            <span
                              style={css(
                                `font:500 12px/16px var(--font-mono);color:var(--foreground);`,
                              )}
                            >{`SKILL.md`}</span>
                            <span
                              style={css(
                                `font:400 11px/1 var(--font-sans);color:var(--muted-foreground);`,
                              )}
                            >{`read-only`}</span>
                          </div>
                          <pre
                            style={css(
                              `margin:0;padding:14px 16px;font:400 12px/1.7 var(--font-mono);color:var(--foreground);white-space:pre-wrap;`,
                            )}
                          >
                            {this.state.skillVersion === "v3"
                              ? sk.md
                                  .split("\n")
                                  .filter(
                                    (line) =>
                                      !line.startsWith("Output:") &&
                                      !line.startsWith("Rules:"),
                                  )
                                  .join("\n")
                              : this.state.skillVersion === "v2"
                                ? `# ${sk.slug}\n\n${sk.desc}`
                                : sk.md}
                          </pre>
                        </div>
                        <div
                          style={css(
                            `display:flex;flex-direction:column;border-left:1px solid var(--border);background:var(--ag-surface-raised);min-height:0;overflow-y:auto;`,
                          )}
                        >
                          <span
                            style={css(
                              `padding:14px 14px 6px;font:500 12px/16px var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >{`Versions`}</span>
                          {sk.versions.map((v, index8) => (
                            <Fragment key={index8}>
                              <button
                                type="button"
                                aria-pressed={
                                  (this.state.skillVersion || "v4") === v.v
                                }
                                onClick={() =>
                                  this.setState({ skillVersion: v.v })
                                }
                                style={css(
                                  `display:flex;flex-direction:column;gap:2px;padding:8px 14px;border:0;text-align:left;background:${(this.state.skillVersion || "v4") === v.v ? "var(--accent)" : "transparent"};`,
                                )}
                              >
                                <span
                                  style={css(
                                    `font:500 12px/16px var(--font-mono);color:var(--foreground);`,
                                  )}
                                >
                                  {v.v}
                                </span>
                                <span
                                  style={css(
                                    `font:400 11px/14px var(--font-sans);color:var(--muted-foreground);`,
                                  )}
                                >
                                  {v.when}
                                </span>
                              </button>
                            </Fragment>
                          ))}
                          <span
                            style={css(
                              `padding:14px 14px 6px;font:500 12px/16px var(--font-sans);color:var(--muted-foreground);border-top:1px solid var(--border);margin-top:8px;`,
                            )}
                          >{`Used by`}</span>
                          {sk.usedBy.map((u, index8) => (
                            <Fragment key={index8}>
                              <div
                                style={css(
                                  `display:flex;align-items:center;gap:8px;padding:6px 14px;`,
                                )}
                              >
                                <span style={css(u.chipStyle)}>
                                  <Robot
                                    size="62%"
                                    weight="regular"
                                    aria-hidden="true"
                                  />
                                </span>
                                <span
                                  style={css(
                                    `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                                  )}
                                >
                                  {u.title}
                                </span>
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
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
            // Same layout as the landing hero's animated session (the .r3-*
            // classes in styles/landing/hero.css): agent header, thread, composer.
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
              <div className="r3-ap-thread" style={css(`overflow-y:auto;`)}>
                <div className="r3-ap-user">
                  <p>{ss.ask}</p>
                </div>
                <div className="r3-ap-worked r3-hx-wk">
                  <span>
                    {ss.worked}
                    <CaretDown size={13} weight="regular" aria-hidden="true" />
                  </span>
                </div>
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
          )}
        </div>
      </div>
    );
  }
}
