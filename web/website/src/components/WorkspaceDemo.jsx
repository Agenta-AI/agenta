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

export default class WorkspaceDemo extends Component {
  componentDidMount() {
    document.addEventListener("keydown", this.onEscape);
  }
  componentWillUnmount() {
    document.removeEventListener("keydown", this.onEscape);
  }
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
    homeTab: "agents",
    homeAgent: 0,
    configOpen: true,
    stepsOpen: true,
  };

  render() {
    const {
      nav,
      view,
      railGroups,
      ss,
      homeAgent,
      homeRows,
      homeShowTemplates,
      homeTabAgents,
      homeTabTemplates,
      homeTabStyleAgents,
      homeTabStyleTemplates,
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
      configOpen,
      configClosed,
      toggleConfig,
      splitCols,
      tabs2,
    } = deriveWorkspace(this.state, (patch) => this.setState(patch));
    const stepsOpen = this.state.stepsOpen;
    const stepsRot = stepsOpen ? "rotate(90deg)" : "rotate(0deg)";
    const toggleSteps = () => this.setState({ stepsOpen: !stepsOpen });

    return (
      <div
        className={`ag-app-frame ag-over-rail`}
        ref={(node) => {
          this.frame = node;
        }}
        data-mobile-config={this.state.mobileConfig || false}
        aria-label="Interactive Agenta workspace demo"
        style={css(
          `position:relative;z-index:6;width:min(1120px,100%);height:680px;border-radius:12px;box-shadow:var(--tplx-panel-shadow);display:grid;grid-template-columns:255px minmax(0,1fr);overflow:hidden;text-align:left;font-family:var(--font-sans);color:var(--foreground);background:var(--background);`,
        )}
      >
        <nav className="ag-demo-mobile-nav" aria-label="Demo screens">
          {["home", "agents", "automations", "skills", "sessions"].map(
            (name) => (
              <button
                key={name}
                type="button"
                aria-pressed={this.state.view === name}
                onClick={nav[name].go}
              >
                {name[0].toUpperCase() + name.slice(1)}
              </button>
            ),
          )}
          {view.playground && (
            <button
              type="button"
              aria-pressed={this.state.mobileConfig || false}
              onClick={() =>
                this.setState({
                  mobileConfig: !this.state.mobileConfig,
                  configOpen: true,
                })
              }
            >
              Configuration
            </button>
          )}
        </nav>
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
            <span
              style={css(
                `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
              )}
            >
              <svg
                width={`16`}
                height={`16`}
                viewBox={`0 0 256 256`}
                fill={`currentColor`}
                aria-hidden={`true`}
              >
                <path
                  d={`M216 40H40a16 16 0 0 0-16 16v144a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a16 16 0 0 0-16-16ZM40 56h56v144H40Zm176 144h-104V56h104Z`}
                />
              </svg>
            </span>
          </div>
          <nav
            style={css(
              `display:flex;flex-direction:column;padding-top:4px;min-height:0;flex:1;`,
            )}
            aria-label="Demo workspace"
          >
            <button
              type={`button`}
              onClick={nav.home.go}
              style={css(nav.home.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M218.8 103.7 133.3 25.9a8 8 0 0 0-10.7 0L37.2 103.7A16 16 0 0 0 32 115.6V208a16 16 0 0 0 16 16h48a8 8 0 0 0 8-8v-56h48v56a8 8 0 0 0 8 8h48a16 16 0 0 0 16-16v-92.4a16 16 0 0 0-5.2-11.9ZM208 208h-40v-56a16 16 0 0 0-16-16h-48a16 16 0 0 0-16 16v56H48v-92.4l80-72.7 80 72.7Z`}
                  />
                </svg>
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Home`}</span>
            </button>
            <button
              type={`button`}
              onClick={nav.agents.go}
              style={css(nav.agents.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M200 48h-64V16a8 8 0 0 0-16 0v32H56a32 32 0 0 0-32 32v112a32 32 0 0 0 32 32h144a32 32 0 0 0 32-32V80a32 32 0 0 0-32-32Zm16 144a16 16 0 0 1-16 16H56a16 16 0 0 1-16-16V80a16 16 0 0 1 16-16h144a16 16 0 0 1 16 16Zm-52-56H92a28 28 0 0 0 0 56h72a28 28 0 0 0 0-56Zm-24 16v24h-24v-24Zm-60 12a12 12 0 0 1 12-12h8v24h-8a12 12 0 0 1-12-12Zm84 12h-8v-24h8a12 12 0 0 1 0 24ZM72 108a12 12 0 1 1 12 12 12 12 0 0 1-12-12Zm88 0a12 12 0 1 1 12 12 12 12 0 0 1-12-12Z`}
                  />
                </svg>
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Agents`}</span>
            </button>
            <button
              type={`button`}
              onClick={nav.automations.go}
              style={css(nav.automations.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                  />
                </svg>
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Automations`}</span>
            </button>
            <button
              type={`button`}
              onClick={nav.skills.go}
              style={css(nav.skills.style)}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M220.3 158.5a8 8 0 0 0-7.1-.6 24 24 0 1 1 0-43.8 8 8 0 0 0 10.8-7.4V64a16 16 0 0 0-16-16h-46.3a40 40 0 1 0-67.4 0H48a16 16 0 0 0-16 16v40a8 8 0 0 0 10.8 7.5 24 24 0 1 1 0 43.8A8 8 0 0 0 32 163v45a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16v-42.6a8 8 0 0 0-3.7-6.9ZM208 208H48v-33.4a40 40 0 1 0 0-77.2V64h64a8 8 0 0 0 6.9-12A24 24 0 1 1 158 45a24 24 0 0 1-4.9 7 8 8 0 0 0 6.9 12h48v33.4a40 40 0 1 0 0 77.2Z`}
                  />
                </svg>
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
              onClick={nav.sessions.go}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M232 128a104 104 0 0 1-135.1 99.3l-40.7 13.6a16 16 0 0 1-20.3-20.3l13.6-40.7A104 104 0 1 1 232 128Zm-16 0a88 88 0 1 0-165.1 42 8 8 0 0 1 .5 6.3L37 216l39.7-14.4a8 8 0 0 1 6.3.5A88 88 0 0 0 216 128Z`}
                  />
                </svg>
              </span>
              <span
                style={css(
                  `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                )}
              >{`Sessions`}</span>
              <span
                style={css(
                  `position:relative;z-index:1;display:flex;flex:0 0 auto;align-items:center;margin-right:4px;color:var(--muted-foreground);`,
                )}
              >
                <span
                  style={css(
                    `display:inline-flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;`,
                  )}
                >
                  <svg
                    width={`13`}
                    height={`13`}
                    viewBox={`0 0 256 256`}
                    fill={`currentColor`}
                    aria-hidden={`true`}
                  >
                    <path
                      d={`M230.6 49.5A16 16 0 0 0 216 40H40a16 16 0 0 0-11.8 26.8L96 141.1V216a16 16 0 0 0 24.9 13.3l32-21.3a16 16 0 0 0 7.1-13.3v-53.6l67.8-74.3a16 16 0 0 0 2.8-17.3ZM148.5 133a8 8 0 0 0-2.5 5.4V194.7l-32 21.3v-77.6a8 8 0 0 0-2.1-5.4L40 56h176Z`}
                    />
                  </svg>
                </span>
              </span>
            </div>
            <div
              style={css(
                `display:flex;flex-direction:column;min-height:0;overflow-y:auto;`,
              )}
            >
              {railGroups.map((g, index4) => (
                <Fragment key={index4}>
                  <div
                    role={`button`}
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
                        `margin-right:4px;display:flex;width:22px;height:22px;flex:0 0 auto;align-items:center;justify-content:center;transform:rotate(90deg);`,
                      )}
                    >
                      <svg
                        width={`11`}
                        height={`11`}
                        viewBox={`0 0 256 256`}
                        fill={`currentColor`}
                        aria-hidden={`true`}
                      >
                        <path
                          d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                        />
                      </svg>
                    </span>
                  </div>
                  {g.rows.map((r, index5) => (
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
                              <svg
                                width={`12`}
                                height={`12`}
                                viewBox={`0 0 256 256`}
                                fill={`currentColor`}
                                aria-hidden={`true`}
                              >
                                <path
                                  d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                />
                              </svg>
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
                          {r.ask}
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
            <div
              style={css(
                `position:relative;box-sizing:border-box;margin:0 auto 4px;display:flex;height:28px;flex:0 0 auto;width:calc(100% - 16px);align-items:center;gap:10px;border-radius:6px;padding:0 12px;font:400 14px/28px var(--font-sans);border:none;background:transparent;cursor:default;text-align:left;color:var(--foreground);`,
              )}
            >
              <span
                style={css(`display:flex;flex:0 0 auto;align-items:center;`)}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M128 80a48 48 0 1 0 48 48 48 48 0 0 0-48-48Zm0 80a32 32 0 1 1 32-32 32 32 0 0 1-32 32Zm88-29.8v-4.4l14.3-17.9a8 8 0 0 0 1.5-6.9 111 111 0 0 0-10.9-26.3 8 8 0 0 0-6-3.9L192.4 68l-3.2-3.1-2.6-22.5a8 8 0 0 0-3.9-6 112 112 0 0 0-26.4-11 8 8 0 0 0-6.9 1.5l-17.9 14.3h-4.3L109.3 27a8 8 0 0 0-6.9-1.5 111 111 0 0 0-26.3 10.9 8 8 0 0 0-3.9 6L69.6 65l-3.1 3.2-22.5 2.6a8 8 0 0 0-6 3.9 112 112 0 0 0-11 26.4 8 8 0 0 0 1.5 6.9l14.3 17.9v4.3L28.5 148.1a8 8 0 0 0-1.5 6.9 111 111 0 0 0 10.9 26.3 8 8 0 0 0 6 3.9L66.5 188l3.1 3.2 2.6 22.5a8 8 0 0 0 3.9 6 112 112 0 0 0 26.4 11 8 8 0 0 0 6.9-1.5l17.9-14.3h4.3l17.9 14.3a8 8 0 0 0 6.9 1.5 111 111 0 0 0 26.3-10.9 8 8 0 0 0 3.9-6l2.6-22.6 3.2-3.1 22.5-2.6a8 8 0 0 0 6-3.9 112 112 0 0 0 11-26.4 8 8 0 0 0-1.5-6.9ZM200 121.2v13.6a8 8 0 0 0 1.7 5l13.5 16.9a95 95 0 0 1-5.8 14L188 173.2a8 8 0 0 0-4.8 2.4l-9.6 9.6a8 8 0 0 0-2.4 4.8l-2.5 21.4a95 95 0 0 1-14 5.8l-16.9-13.5a8 8 0 0 0-5-1.7h-13.6a8 8 0 0 0-5 1.7l-16.9 13.5a95 95 0 0 1-14-5.8L80.8 190a8 8 0 0 0-2.4-4.8l-9.6-9.6a8 8 0 0 0-4.8-2.4l-21.4-2.5a95 95 0 0 1-5.8-14l13.5-16.9a8 8 0 0 0 1.7-5v-13.6a8 8 0 0 0-1.7-5L36.8 99.3a95 95 0 0 1 5.8-14L64 82.8a8 8 0 0 0 4.8-2.4l9.6-9.6a8 8 0 0 0 2.4-4.8l2.5-21.4a95 95 0 0 1 14-5.8l16.9 13.5a8 8 0 0 0 5 1.7h13.6a8 8 0 0 0 5-1.7l16.9-13.5a95 95 0 0 1 14 5.8l2.5 21.5a8 8 0 0 0 2.4 4.8l9.6 9.6a8 8 0 0 0 4.8 2.4l21.4 2.5a95 95 0 0 1 5.8 14l-13.5 16.9a8 8 0 0 0-1.7 5Z`}
                  />
                </svg>
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
              <span
                style={css(
                  `display:inline-flex;width:24px;height:24px;flex:0 0 auto;align-items:center;justify-content:center;color:var(--muted-foreground);`,
                )}
              >
                <svg
                  width={`16`}
                  height={`16`}
                  viewBox={`0 0 256 256`}
                  fill={`currentColor`}
                  aria-hidden={`true`}
                >
                  <path
                    d={`M140 180a12 12 0 1 1-12-12 12 12 0 0 1 12 12ZM128 72c-22.1 0-40 16.1-40 36v4a8 8 0 0 0 16 0v-4c0-11 10.8-20 24-20s24 9 24 20-10.8 20-24 20a8 8 0 0 0-8 8v8a8 8 0 0 0 16 0v-.7c18.2-3.3 32-17.5 32-35.3 0-19.9-17.9-36-40-36Zm104 56A104 104 0 1 1 128 24a104.1 104.1 0 0 1 104 104Zm-16 0a88 88 0 1 0-88 88 88.1 88.1 0 0 0 88-88Z`}
                  />
                </svg>
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
                  `display:flex;flex:1;min-height:0;flex-direction:column;overflow-y:auto;padding:120px 64px 64px;`,
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
                    >{`Good evening, Mahmoud`}</span>
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
                        style={css(
                          `display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:6px;font:400 14px/1 var(--font-sans);color:var(--foreground);`,
                        )}
                      >
                        <span style={css(homeAgent.chipStyle)}>
                          {homeAgent.initials}
                        </span>
                        {homeAgent.title}
                        <span
                          style={css(
                            `display:inline-flex;color:var(--muted-foreground);`,
                          )}
                        >
                          <svg
                            width={`10`}
                            height={`10`}
                            viewBox={`0 0 256 256`}
                            fill={`currentColor`}
                            aria-hidden={`true`}
                          >
                            <path
                              d={`m213.7 101.7-80 80a8 8 0 0 1-11.4 0l-80-80a8 8 0 0 1 11.4-11.4L128 164.7l74.3-74.4a8 8 0 0 1 11.4 11.4Z`}
                            />
                          </svg>
                        </span>
                      </span>
                      <span style={css(`flex:1;`)}></span>
                      <span
                        style={css(
                          `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:999px;background:var(--primary);color:var(--primary-foreground);`,
                        )}
                      >
                        <svg
                          width={`14`}
                          height={`14`}
                          viewBox={`0 0 24 24`}
                          fill={`none`}
                          stroke={`currentColor`}
                          strokeWidth={`2.2`}
                          strokeLinecap={`round`}
                          strokeLinejoin={`round`}
                        >
                          <path d={`M12 19V5M5 12l7-7 7 7`} />
                        </svg>
                      </span>
                    </div>
                  </div>
                  <div
                    style={css(
                      `margin:-4px -8px 0;display:flex;flex-direction:column;gap:8px;`,
                    )}
                  >
                    <div
                      style={css(
                        `margin:0 8px 4px;display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--ag-colorSplit);padding:0 6px;`,
                      )}
                    >
                      <button
                        type={`button`}
                        onClick={homeTabAgents}
                        style={css(homeTabStyleAgents)}
                      >{`Your agents`}</button>
                      <button
                        type={`button`}
                        onClick={homeTabTemplates}
                        style={css(homeTabStyleTemplates)}
                      >{`Templates`}</button>
                      <span style={css(`flex:1;`)}></span>
                      <span style={css(`padding-bottom:7px;`)}>
                        <span
                          style={css(
                            `display:flex;height:28px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:400 13px/1 var(--font-sans);color:var(--foreground);white-space:nowrap;`,
                          )}
                        >
                          <svg
                            width={`12`}
                            height={`12`}
                            viewBox={`0 0 256 256`}
                            fill={`currentColor`}
                            aria-hidden={`true`}
                          >
                            <path
                              d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                            />
                          </svg>
                          {`New agent`}
                        </span>
                      </span>
                    </div>
                    <div
                      style={css(
                        `display:flex;max-height:330px;flex-direction:column;gap:2px;overflow-y:auto;`,
                      )}
                    >
                      {homeRows.map((r, index7) => (
                        <Fragment key={index7}>
                          <button
                            type={`button`}
                            onClick={r.open}
                            style={css(r.rowStyle)}
                          >
                            <span style={css(r.tileStyle)}>{r.initials}</span>
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
                              <>
                                <span
                                  style={css(
                                    `margin-left:8px;display:inline-flex;flex:0 0 auto;color:var(--foreground);`,
                                  )}
                                >
                                  <svg
                                    width={`14`}
                                    height={`14`}
                                    viewBox={`0 0 256 256`}
                                    fill={`currentColor`}
                                    aria-hidden={`true`}
                                  >
                                    <path
                                      d={`M229.7 77.7 106.3 201a8 8 0 0 1-11.3 0l-53.7-53.7a8 8 0 0 1 11.4-11.3L100.7 184 218.3 66.3a8 8 0 0 1 11.4 11.4Z`}
                                    />
                                  </svg>
                                </span>
                              </>
                            )}
                          </button>
                        </Fragment>
                      ))}
                      {homeShowTemplates && (
                        <>
                          <div
                            style={css(
                              `box-sizing:border-box;display:flex;width:100%;align-items:center;gap:14px;border-radius:10px;padding:8px 14px;`,
                            )}
                          >
                            <span
                              style={css(
                                `display:flex;width:34px;height:34px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:10px;border:1px dashed var(--border);color:var(--muted-foreground);`,
                              )}
                            >
                              <svg
                                width={`17`}
                                height={`17`}
                                viewBox={`0 0 256 256`}
                                fill={`currentColor`}
                                aria-hidden={`true`}
                              >
                                <path
                                  d={`M80 64a8 8 0 0 1 8-8h128a8 8 0 0 1 0 16H88a8 8 0 0 1-8-8Zm136 56H88a8 8 0 0 0 0 16h128a8 8 0 0 0 0-16Zm0 64H88a8 8 0 0 0 0 16h128a8 8 0 0 0 0-16ZM44 52a12 12 0 1 0 12 12 12 12 0 0 0-12-12Zm0 64a12 12 0 1 0 12 12 12 12 0 0 0-12-12Zm0 64a12 12 0 1 0 12 12 12 12 0 0 0-12-12Z`}
                                />
                              </svg>
                            </span>
                            <span
                              style={css(
                                `flex:1;font:400 14px/1.45 var(--font-sans);color:var(--foreground);`,
                              )}
                            >{`Browse all 12 templates`}</span>
                            <span
                              style={css(
                                `display:inline-flex;color:var(--muted-foreground);`,
                              )}
                            >
                              <svg
                                width={`13`}
                                height={`13`}
                                viewBox={`0 0 256 256`}
                                fill={`currentColor`}
                                aria-hidden={`true`}
                              >
                                <path
                                  d={`m221.7 133.7-72 72a8 8 0 0 1-11.4-11.4L196.7 136H40a8 8 0 0 1 0-16h156.7l-58.4-58.3a8 8 0 0 1 11.4-11.4l72 72a8 8 0 0 1 0 11.4Z`}
                                />
                              </svg>
                            </span>
                          </div>
                        </>
                      )}
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
                    <svg
                      width={`14`}
                      height={`14`}
                      viewBox={`0 0 256 256`}
                      fill={`currentColor`}
                      aria-hidden={`true`}
                    >
                      <path
                        d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                      />
                    </svg>
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
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 24 24`}
                        fill={`none`}
                        stroke={`currentColor`}
                        strokeWidth={`2`}
                        strokeLinecap={`round`}
                        strokeLinejoin={`round`}
                      >
                        <circle cx={`11`} cy={`11`} r={`8`} />
                        <path d={`m21 21-4.3-4.3`} />
                      </svg>
                    </span>
                    {`Search agents by name…`}
                  </span>
                  <span
                    style={css(
                      `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                    )}
                  >
                    <svg
                      width={`14`}
                      height={`14`}
                      viewBox={`0 0 256 256`}
                      fill={`currentColor`}
                      aria-hidden={`true`}
                    >
                      <path
                        d={`M230.6 49.5A16 16 0 0 0 216 40H40a16 16 0 0 0-11.8 26.8L96 141.1V216a16 16 0 0 0 24.9 13.3l32-21.3a16 16 0 0 0 7.1-13.3v-53.6l67.8-74.3a16 16 0 0 0 2.8-17.3ZM148.5 133a8 8 0 0 0-2.5 5.4V194.7l-32 21.3v-77.6a8 8 0 0 0-2.1-5.4L40 56h176Z`}
                      />
                    </svg>
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
                          <span style={css(a.chipStyle)}>{a.initials}</span>
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
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M140 128a12 12 0 1 1-12-12 12 12 0 0 1 12 12Zm56-12a12 12 0 1 0 12 12 12 12 0 0 0-12-12ZM60 116a12 12 0 1 0 12 12 12 12 0 0 0-12-12Z`}
                              />
                            </svg>
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
                        <svg
                          width={`14`}
                          height={`14`}
                          viewBox={`0 0 256 256`}
                          fill={`currentColor`}
                          aria-hidden={`true`}
                        >
                          <path
                            d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                          />
                        </svg>
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
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`2`}
                            strokeLinecap={`round`}
                            strokeLinejoin={`round`}
                          >
                            <circle cx={`11`} cy={`11`} r={`8`} />
                            <path d={`m21 21-4.3-4.3`} />
                          </svg>
                        </span>
                        {`Search automations`}
                      </span>
                      <span
                        style={css(
                          `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                        )}
                      >
                        <svg
                          width={`14`}
                          height={`14`}
                          viewBox={`0 0 256 256`}
                          fill={`currentColor`}
                          aria-hidden={`true`}
                        >
                          <path
                            d={`M230.6 49.5A16 16 0 0 0 216 40H40a16 16 0 0 0-11.8 26.8L96 141.1V216a16 16 0 0 0 24.9 13.3l32-21.3a16 16 0 0 0 7.1-13.3v-53.6l67.8-74.3a16 16 0 0 0 2.8-17.3ZM148.5 133a8 8 0 0 0-2.5 5.4V194.7l-32 21.3v-77.6a8 8 0 0 0-2.1-5.4L40 56h176Z`}
                          />
                        </svg>
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
                                      <svg
                                        width={`15`}
                                        height={`15`}
                                        viewBox={`0 0 256 256`}
                                        fill={`currentColor`}
                                        aria-hidden={`true`}
                                      >
                                        <path
                                          d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                        />
                                      </svg>
                                    </>
                                  )}
                                  {r.isSchedule && (
                                    <>
                                      <svg
                                        width={`15`}
                                        height={`15`}
                                        viewBox={`0 0 256 256`}
                                        fill={`currentColor`}
                                        aria-hidden={`true`}
                                      >
                                        <path
                                          d={`M136 80v43.5l37.7 22.6a8 8 0 0 1-8.2 13.8l-41.6-25a8 8 0 0 1-3.9-6.9V80a8 8 0 0 1 16 0Zm88-48a8 8 0 0 0-8 8v22.6A104 104 0 0 0 33.6 79.4a8 8 0 0 0 14.1 7.5A88 88 0 0 1 205.1 68H192a8 8 0 0 0 0 16h32a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-3.3 118.6a8 8 0 0 0-10 5.2A88 88 0 0 1 128 216a87.5 87.5 0 0 1-76.1-44l-3.3-6a8 8 0 1 0-14 7.7l3.3 6A104 104 0 0 0 225.9 160.7a8 8 0 0 0-5.2-10.1Z`}
                                        />
                                      </svg>
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
                                  <svg
                                    width={`16`}
                                    height={`16`}
                                    viewBox={`0 0 256 256`}
                                    fill={`currentColor`}
                                    aria-hidden={`true`}
                                  >
                                    <path
                                      d={`M140 128a12 12 0 1 1-12-12 12 12 0 0 1 12 12Zm56-12a12 12 0 1 0 12 12 12 12 0 0 0-12-12ZM60 116a12 12 0 1 0 12 12 12 12 0 0 0-12-12Z`}
                                    />
                                  </svg>
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
              {hasAutomation && (
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
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 256 256`}
                        fill={`currentColor`}
                        aria-hidden={`true`}
                      >
                        <path
                          d={`M224 128a8 8 0 0 1-8 8H59.3l58.4 58.3a8 8 0 0 1-11.4 11.4l-72-72a8 8 0 0 1 0-11.4l72-72a8 8 0 0 1 11.4 11.4L59.3 120H216a8 8 0 0 1 8 8Z`}
                        />
                      </svg>
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
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M140 128a12 12 0 1 1-12-12 12 12 0 0 1 12 12Zm56-12a12 12 0 1 0 12 12 12 12 0 0 0-12-12ZM60 116a12 12 0 1 0 12 12 12 12 0 0 0-12-12Z`}
                              />
                            </svg>
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
                              <svg
                                width={`12`}
                                height={`12`}
                                viewBox={`0 0 24 24`}
                                fill={`none`}
                                stroke={`currentColor`}
                                strokeWidth={`2`}
                                strokeLinecap={`round`}
                                strokeLinejoin={`round`}
                              >
                                <path d={`m6 9 6 6 6-6`} />
                              </svg>
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
                                    <svg
                                      width={`14`}
                                      height={`14`}
                                      viewBox={`0 0 256 256`}
                                      fill={`currentColor`}
                                      aria-hidden={`true`}
                                    >
                                      <path
                                        d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                      />
                                    </svg>
                                  </>
                                )}
                                {au.isSchedule && (
                                  <>
                                    <svg
                                      width={`14`}
                                      height={`14`}
                                      viewBox={`0 0 256 256`}
                                      fill={`currentColor`}
                                      aria-hidden={`true`}
                                    >
                                      <path
                                        d={`M208 32h-24v-8a8 8 0 0 0-16 0v8H88v-8a8 8 0 0 0-16 0v8H48a16 16 0 0 0-16 16v160a16 16 0 0 0 16 16h160a16 16 0 0 0 16-16V48a16 16 0 0 0-16-16ZM72 48v8a8 8 0 0 0 16 0v-8h80v8a8 8 0 0 0 16 0v-8h24v32H48V48Zm136 160H48V96h160v112Z`}
                                      />
                                    </svg>
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
                              <svg
                                width={`12`}
                                height={`12`}
                                viewBox={`0 0 24 24`}
                                fill={`none`}
                                stroke={`currentColor`}
                                strokeWidth={`2`}
                                strokeLinecap={`round`}
                                strokeLinejoin={`round`}
                              >
                                <path d={`m6 9 6 6 6-6`} />
                              </svg>
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
                          <svg
                            width={`15`}
                            height={`15`}
                            viewBox={`0 0 256 256`}
                            fill={`currentColor`}
                            aria-hidden={`true`}
                          >
                            <path
                              d={`M136 80v43.5l37.7 22.6a8 8 0 0 1-8.2 13.8l-41.6-25a8 8 0 0 1-3.9-6.9V80a8 8 0 0 1 16 0Zm88-48a8 8 0 0 0-8 8v22.6A104 104 0 0 0 33.6 79.4a8 8 0 0 0 14.1 7.5A88 88 0 0 1 205.1 68H192a8 8 0 0 0 0 16h32a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-3.3 118.6a8 8 0 0 0-10 5.2A88 88 0 0 1 128 216a87.5 87.5 0 0 1-76.1-44l-3.3-6a8 8 0 1 0-14 7.7l3.3 6A104 104 0 0 0 225.9 160.7a8 8 0 0 0-5.2-10.1Z`}
                            />
                          </svg>
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
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 256 256`}
                            fill={`currentColor`}
                            aria-hidden={`true`}
                          >
                            <path
                              d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                            />
                          </svg>
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
                        <svg
                          width={`14`}
                          height={`14`}
                          viewBox={`0 0 24 24`}
                          fill={`none`}
                          stroke={`currentColor`}
                          strokeWidth={`2`}
                          strokeLinecap={`round`}
                          strokeLinejoin={`round`}
                        >
                          <circle cx={`11`} cy={`11`} r={`8`} />
                          <path d={`m21 21-4.3-4.3`} />
                        </svg>
                      </span>
                      {`Search skills by name…`}
                    </span>
                    <span
                      style={css(
                        `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;padding:0 12px;background:var(--primary);color:var(--primary-foreground);font:500 14px/1 var(--font-sans);`,
                      )}
                    >
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 256 256`}
                        fill={`currentColor`}
                        aria-hidden={`true`}
                      >
                        <path
                          d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                        />
                      </svg>
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
                                        <svg
                                          width={`13`}
                                          height={`13`}
                                          viewBox={`0 0 256 256`}
                                          fill={`currentColor`}
                                          aria-hidden={`true`}
                                        >
                                          <path
                                            d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                          />
                                        </svg>
                                      </>
                                    )}
                                    {k.project && <>{`sk`}</>}
                                  </span>
                                  <span
                                    style={css(
                                      `min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 12px/16px var(--font-mono);color:var(--ag-colorText);`,
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
                              <svg
                                width={`13`}
                                height={`13`}
                                viewBox={`0 0 256 256`}
                                fill={`currentColor`}
                                aria-hidden={`true`}
                              >
                                <path
                                  d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                />
                              </svg>
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
                              `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 14px/18px var(--font-mono);color:var(--foreground);`,
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
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`2`}
                            strokeLinecap={`round`}
                          >
                            <path d={`M18 6 6 18M6 6l12 12`} />
                          </svg>
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
                            {sk.md}
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
                              <div
                                style={css(
                                  `display:flex;flex-direction:column;gap:2px;padding:8px 14px;${v.style}`,
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
                              </div>
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
                                  {u.initials}
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
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 24 24`}
                        fill={`none`}
                        stroke={`currentColor`}
                        strokeWidth={`2`}
                        strokeLinecap={`round`}
                        strokeLinejoin={`round`}
                      >
                        <circle cx={`11`} cy={`11`} r={`8`} />
                        <path d={`m21 21-4.3-4.3`} />
                      </svg>
                    </span>
                    {`Search sessions`}
                  </span>
                  <span
                    style={css(
                      `display:inline-flex;height:32px;align-items:center;gap:6px;border-radius:6px;border:1px solid var(--border);padding:0 10px;font:500 13px/1 var(--font-sans);color:var(--foreground);background:transparent;`,
                    )}
                  >
                    <svg
                      width={`14`}
                      height={`14`}
                      viewBox={`0 0 256 256`}
                      fill={`currentColor`}
                      aria-hidden={`true`}
                    >
                      <path
                        d={`M230.6 49.5A16 16 0 0 0 216 40H40a16 16 0 0 0-11.8 26.8L96 141.1V216a16 16 0 0 0 24.9 13.3l32-21.3a16 16 0 0 0 7.1-13.3v-53.6l67.8-74.3a16 16 0 0 0 2.8-17.3ZM148.5 133a8 8 0 0 0-2.5 5.4V194.7l-32 21.3v-77.6a8 8 0 0 0-2.1-5.4L40 56h176Z`}
                      />
                    </svg>
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
                              `display:flex;width:12px;flex:0 0 auto;align-items:center;justify-content:center;color:${r.railDot};`,
                            )}
                          >
                            {r.auto && (
                              <>
                                <svg
                                  width={`12`}
                                  height={`12`}
                                  viewBox={`0 0 256 256`}
                                  fill={`currentColor`}
                                  aria-hidden={`true`}
                                >
                                  <path
                                    d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                  />
                                </svg>
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
                                {r.ask}
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
                            {r.initials}
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
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M140 128a12 12 0 1 1-12-12 12 12 0 0 1 12 12Zm56-12a12 12 0 1 0 12 12 12 12 0 0 0-12-12ZM60 116a12 12 0 1 0 12 12 12 12 0 0 0-12-12Z`}
                              />
                            </svg>
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
            <>
              <div
                style={css(
                  `display:flex;min-height:41px;flex:0 0 auto;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--ag-shell-line);background:var(--ag-surface-raised);padding:8px 10px;`,
                )}
              >
                <div
                  style={css(
                    `display:flex;min-width:0;align-items:center;gap:8px;`,
                  )}
                >
                  <span style={css(ss.chipStyle)}>{ss.initials}</span>
                  <span
                    style={css(
                      `overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 16px/18px var(--font-sans);color:var(--foreground);`,
                    )}
                  >
                    {ss.title}
                  </span>
                  <span
                    style={css(
                      `margin:0 4px;height:20px;width:1px;flex:0 0 auto;background:var(--ag-colorBorderSecondary);`,
                    )}
                  ></span>
                  <span
                    style={css(
                      `display:inline-flex;align-items:center;gap:6px;font:400 13px/1 var(--font-sans);color:var(--muted-foreground);`,
                    )}
                  >
                    <span
                      style={css(
                        `border-radius:4px;background:var(--ag-colorFillTertiary);padding:3px 6px;font:500 12px/1 var(--font-mono);color:var(--foreground);`,
                      )}
                    >
                      {ss.version}
                    </span>
                    <span
                      style={css(
                        `display:inline-flex;align-items:center;gap:5px;`,
                      )}
                    >
                      <span
                        style={css(
                          `width:6px;height:6px;border-radius:50%;background:var(--success);`,
                        )}
                      ></span>
                      {`Saved`}
                    </span>
                  </span>
                </div>
                <div
                  style={css(
                    `display:flex;min-width:0;flex:1;align-items:center;justify-content:flex-end;gap:8px;`,
                  )}
                >
                  <span
                    style={css(
                      `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                    )}
                  >
                    <svg
                      width={`15`}
                      height={`15`}
                      viewBox={`0 0 256 256`}
                      fill={`currentColor`}
                      aria-hidden={`true`}
                    >
                      <path
                        d={`M140 180a12 12 0 1 1-12-12 12 12 0 0 1 12 12ZM128 72c-22.1 0-40 16.1-40 36v4a8 8 0 0 0 16 0v-4c0-11 10.8-20 24-20s24 9 24 20-10.8 20-24 20a8 8 0 0 0-8 8v8a8 8 0 0 0 16 0v-.7c18.2-3.3 32-17.5 32-35.3 0-19.9-17.9-36-40-36Zm104 56A104 104 0 1 1 128 24a104.1 104.1 0 0 1 104 104Zm-16 0a88 88 0 1 0-88 88 88.1 88.1 0 0 0 88-88Z`}
                      />
                    </svg>
                  </span>
                </div>
              </div>
              <div
                className={`ag-app-split`}
                style={css(
                  `display:grid;grid-template-columns:${splitCols};flex:1;min-height:0;background:var(--ag-surface-app);`,
                )}
              >
                {configOpen && (
                  <>
                    <div
                      className={`ag-app-config`}
                      style={css(
                        `display:flex;flex-direction:column;min-height:0;overflow-y:auto;background:var(--ag-surface-raised);border-right:1px solid var(--ag-shell-line);`,
                      )}
                    >
                      <div
                        style={css(
                          `display:flex;align-items:center;justify-content:space-between;gap:8px;height:41px;padding:0 16px;border-bottom:1px solid var(--ag-shell-line);background:var(--ag-surface-section-header);position:sticky;top:0;z-index:2;`,
                        )}
                      >
                        <span
                          style={css(
                            `font:600 13px/1 var(--font-sans);color:var(--foreground);`,
                          )}
                        >{`Configuration`}</span>
                        <button
                          type={`button`}
                          aria-label={
                            configOpen
                              ? "Hide configuration"
                              : "Show configuration"
                          }
                          aria-expanded={configOpen}
                          onClick={toggleConfig}
                          aria-label={`Hide configuration`}
                          style={css(
                            `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;border:none;background:transparent;cursor:default;color:var(--muted-foreground);`,
                          )}
                        >
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`2`}
                            strokeLinecap={`round`}
                            strokeLinejoin={`round`}
                            aria-hidden={`true`}
                          >
                            <path d={`m11 17-5-5 5-5M18 17l-5-5 5-5`} />
                          </svg>
                        </button>
                      </div>
                      <div
                        style={css(
                          `background:var(--ag-surface-section-content);padding:4px 16px 12px;display:flex;flex-direction:column;`,
                        )}
                      >
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M144 96h-32a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h32a16 16 0 0 0 16-16v-32a16 16 0 0 0-16-16Zm0 48h-32v-32h32Zm88-8a8 8 0 0 0 0-16h-16v-32h16a8 8 0 0 0 0-16h-16.4A32.1 32.1 0 0 0 184 40.4V24a8 8 0 0 0-16 0v16h-32V24a8 8 0 0 0-16 0v16H88V24a8 8 0 0 0-16 0v16.4A32.1 32.1 0 0 0 40.4 72H24a8 8 0 0 0 0 16h16v32H24a8 8 0 0 0 0 16h16v32H24a8 8 0 0 0 0 16h16.4A32.1 32.1 0 0 0 72 215.6V232a8 8 0 0 0 16 0v-16h32v16a8 8 0 0 0 16 0v-16h32v16a8 8 0 0 0 16 0v-16.4a32.1 32.1 0 0 0 31.6-31.6H232a8 8 0 0 0 0-16h-16v-32ZM200 184a16 16 0 0 1-16 16H72a16 16 0 0 1-16-16V72a16 16 0 0 1 16-16h112a16 16 0 0 1 16 16Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`Model`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >
                            {ss.model}
                          </span>
                          <span
                            style={css(
                              `display:inline-flex;color:var(--placeholder);`,
                            )}
                          >
                            <svg
                              width={`11`}
                              height={`11`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                              />
                            </svg>
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M213.7 82.3l-56-56A8 8 0 0 0 152 24H56a16 16 0 0 0-16 16v176a16 16 0 0 0 16 16h144a16 16 0 0 0 16-16V88a8 8 0 0 0-2.3-5.7ZM160 51.3 188.7 80H160ZM200 216H56V40h88v48a8 8 0 0 0 8 8h48Zm-32-80a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Zm0 32a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`Instructions`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >{`AGENTS.md · ${ss.words} words`}</span>
                          <span
                            style={css(
                              `display:inline-flex;color:var(--placeholder);`,
                            )}
                          >
                            <svg
                              width={`11`}
                              height={`11`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                              />
                            </svg>
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M226.8 61.7a8 8 0 0 0-12.9-2.4L182.4 90.8l-17.2-17.2 31.5-31.5a8 8 0 0 0-2.4-12.9 72 72 0 0 0-96.8 90.5L26.3 190.9a24 24 0 0 0 33.9 33.9l71.2-71.2a72 72 0 0 0 95.4-91.9ZM199.2 149a56.1 56.1 0 0 1-65 10.5 8 8 0 0 0-9.3 1.4l-76 76a8 8 0 0 1-11.3-11.3l76-76a8 8 0 0 0 1.4-9.3A56 56 0 0 1 178.6 45l-30.4 30.4a8 8 0 0 0 0 11.3l28.5 28.5a8 8 0 0 0 11.3 0L218.4 85a56 56 0 0 1-19.2 64Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`Tools`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >{`${ss.toolCount} enabled`}</span>
                          <span
                            style={css(
                              `display:inline-flex;color:var(--placeholder);`,
                            )}
                          >
                            <svg
                              width={`11`}
                              height={`11`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                              />
                            </svg>
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M149.7 195.7 138.3 207a52.6 52.6 0 0 1-72.3 2.2l-16.3 16.5a8 8 0 0 1-11.4-11.4l16.4-16.4A52.6 52.6 0 0 1 57 125.7l11.3-11.4a8 8 0 0 1 11.4 0l69.9 70a8 8 0 0 1 .1 11.4Zm-71.9-64.4L68.3 141a36.6 36.6 0 0 0 0 51.7 36.5 36.5 0 0 0 51.7 0l9.7-9.6Zm140-86.7a8 8 0 0 0-11.4 0L190 61.1a52.6 52.6 0 0 0-72.3 2.2L106.3 74.7a8 8 0 0 0 0 11.4l69.9 69.9a8 8 0 0 0 11.4 0L199 144.7a52.6 52.6 0 0 0 2.2-72.3l16.6-16.5a8 8 0 0 0 0-11.3Zm-30.1 88.7-9.7 9.7-58.6-58.6 9.6-9.7a36.6 36.6 0 0 1 51.7 0 36.6 36.6 0 0 1 7 51.7Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`MCP servers`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >{`${ss.mcpCount} connected`}</span>
                          <span
                            style={css(
                              `display:inline-flex;color:var(--placeholder);`,
                            )}
                          >
                            <svg
                              width={`11`}
                              height={`11`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                              />
                            </svg>
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M251.8 88.8 133.8 24.9a12 12 0 0 0-11.5 0L4.2 88.8a8 8 0 0 0 0 14.4L32 118.4v50.6a15.9 15.9 0 0 0 4.2 10.8C46.6 191.2 76.1 216 128 216a130.3 130.3 0 0 0 48-8.8V232a8 8 0 0 0 16 0v-32.8a115.6 115.6 0 0 0 27.9-19.4 16 16 0 0 0 4.1-10.8v-50.6l27.8-15.2a8 8 0 0 0 0-14.4ZM128 200c-43.3 0-68.7-18.8-80-31v-42l76.2 41.4a8 8 0 0 0 7.6 0L176 147.5v40a115.3 115.3 0 0 1-48 12.5Zm80-31a92.6 92.6 0 0 1-16 14.7v-44.8l16-8.7Zm-52.1-21.4L128 165.6 24.7 96 128 40.4 231.3 96l-3.7 2a8 8 0 0 0-3.6 5.7Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`Skills`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >{`${ss.skillCount} skills`}</span>
                          <span
                            style={css(
                              `display:inline-flex;color:var(--placeholder);`,
                            )}
                          >
                            <svg
                              width={`11`}
                              height={`11`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                              />
                            </svg>
                          </span>
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                          )}
                        >
                          <span
                            style={css(
                              `display:inline-flex;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M208 40H48a16 16 0 0 0-16 16v58.8c0 89.6 75.8 119.3 91 124.4a16 16 0 0 0 10 0c15.2-5.1 91-34.8 91-124.4V56a16 16 0 0 0-16-16Zm0 74.8c0 78.2-66.4 104.4-80 109.2-13.5-4.7-80-30.9-80-109.2V56h160Zm-34.3-25.5-56 56a8 8 0 0 1-11.4 0l-24-24a8 8 0 0 1 11.4-11.3L112 128.3l50.3-50.3a8 8 0 0 1 11.4 11.3Z`}
                              />
                            </svg>
                          </span>
                          <span
                            style={css(
                              `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                            )}
                          >{`Permissions`}</span>
                          <span
                            style={css(
                              `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%;`,
                            )}
                          >{`Ask before external actions`}</span>
                          <span style={css(`width:11px;`)}></span>
                        </div>
                      </div>
                      <div
                        style={css(
                          `display:flex;align-items:center;justify-content:space-between;gap:8px;height:41px;padding:0 16px;border-bottom:1px solid var(--ag-shell-line);background:var(--ag-surface-section-header);`,
                        )}
                      >
                        <span
                          style={css(
                            `font:600 13px/1 var(--font-sans);color:var(--foreground);`,
                          )}
                        >{`Automations`}</span>
                        <span
                          style={css(
                            `display:inline-flex;align-items:center;gap:4px;`,
                          )}
                        >
                          <span
                            style={css(
                              `font:400 12px/1 var(--font-sans);color:var(--ag-colorTextTertiary);`,
                            )}
                          >
                            {ss.autoCount}
                          </span>
                          <span
                            style={css(
                              `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                            )}
                          >
                            <svg
                              width={`16`}
                              height={`16`}
                              viewBox={`0 0 256 256`}
                              fill={`currentColor`}
                              aria-hidden={`true`}
                            >
                              <path
                                d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                              />
                            </svg>
                          </span>
                        </span>
                      </div>
                      <div
                        style={css(
                          `background:var(--ag-surface-section-content);padding:0 16px;display:flex;flex-direction:column;`,
                        )}
                      >
                        {ss.autos.map((a, index7) => (
                          <Fragment key={index7}>
                            <div
                              style={css(
                                `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);height:40px;`,
                              )}
                            >
                              <span
                                style={css(
                                  `${a.kindStyle}width:24px;height:24px;border-radius:5px;`,
                                )}
                              >
                                {a.isEvent && (
                                  <>
                                    <svg
                                      width={`13`}
                                      height={`13`}
                                      viewBox={`0 0 256 256`}
                                      fill={`currentColor`}
                                      aria-hidden={`true`}
                                    >
                                      <path
                                        d={`M215.8 118.2a8 8 0 0 0-5-5.7L153.2 90.9l14.6-73.3a8 8 0 0 0-13.7-7.1L42.1 129.3a8 8 0 0 0 3.1 12.9l57.6 21.6-14.6 73.3a8 8 0 0 0 13.7 7.1l112-118.9a8 8 0 0 0 1.9-7.1Zm-105.4 97.5 11.4-57.3a8 8 0 0 0-5-9.1L61.2 129.6 145.6 40l-11.4 57.3a8 8 0 0 0 5 9.1l55.6 20.9Z`}
                                      />
                                    </svg>
                                  </>
                                )}
                                {a.isSchedule && (
                                  <>
                                    <svg
                                      width={`13`}
                                      height={`13`}
                                      viewBox={`0 0 256 256`}
                                      fill={`currentColor`}
                                      aria-hidden={`true`}
                                    >
                                      <path
                                        d={`M136 80v43.5l37.7 22.6a8 8 0 0 1-8.2 13.8l-41.6-25a8 8 0 0 1-3.9-6.9V80a8 8 0 0 1 16 0Zm88-48a8 8 0 0 0-8 8v22.6A104 104 0 0 0 33.6 79.4a8 8 0 0 0 14.1 7.5A88 88 0 0 1 205.1 68H192a8 8 0 0 0 0 16h32a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-3.3 118.6a8 8 0 0 0-10 5.2A88 88 0 0 1 128 216a87.5 87.5 0 0 1-76.1-44l-3.3-6a8 8 0 1 0-14 7.7l3.3 6A104 104 0 0 0 225.9 160.7a8 8 0 0 0-5.2-10.1Z`}
                                      />
                                    </svg>
                                  </>
                                )}
                              </span>
                              <span
                                style={css(
                                  `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                                )}
                              >
                                {a.name}
                              </span>
                              <span
                                style={css(
                                  `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);white-space:nowrap;`,
                                )}
                              >
                                {a.runsWhen}
                              </span>
                            </div>
                          </Fragment>
                        ))}
                      </div>
                      <div
                        style={css(
                          `display:flex;align-items:center;justify-content:space-between;gap:8px;height:41px;padding:0 16px;border-bottom:1px solid var(--ag-shell-line);background:var(--ag-surface-section-header);`,
                        )}
                      >
                        <span
                          style={css(
                            `font:600 13px/1 var(--font-sans);color:var(--foreground);`,
                          )}
                        >{`Files`}</span>
                        <span
                          style={css(
                            `font:400 12px/1 var(--font-sans);color:var(--ag-colorTextTertiary);`,
                          )}
                        >{`${ss.fileCount} files`}</span>
                      </div>
                      <div
                        style={css(
                          `flex:1;background:var(--ag-surface-section-content);padding:4px 16px 12px;display:flex;flex-direction:column;`,
                        )}
                      >
                        {ss.files.map((f, index7) => (
                          <Fragment key={index7}>
                            <div
                              style={css(
                                `display:flex;align-items:center;gap:10px;height:36px;font:400 13px/18px var(--font-sans);color:var(--foreground);`,
                              )}
                            >
                              <span
                                style={css(
                                  `display:inline-flex;color:var(--muted-foreground);`,
                                )}
                              >
                                <svg
                                  width={`15`}
                                  height={`15`}
                                  viewBox={`0 0 256 256`}
                                  fill={`currentColor`}
                                  aria-hidden={`true`}
                                >
                                  <path
                                    d={`M213.7 82.3l-56-56A8 8 0 0 0 152 24H56a16 16 0 0 0-16 16v176a16 16 0 0 0 16 16h144a16 16 0 0 0 16-16V88a8 8 0 0 0-2.3-5.7ZM160 51.3 188.7 80H160ZM200 216H56V40h88v48a8 8 0 0 0 8 8h48Zm-32-80a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Zm0 32a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Z`}
                                  />
                                </svg>
                              </span>
                              <span
                                style={css(
                                  `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:12px;`,
                                )}
                              >
                                {f.name}
                              </span>
                              <span
                                style={css(
                                  `font:400 12px/16px var(--font-sans);color:var(--muted-foreground);white-space:nowrap;`,
                                )}
                              >
                                {f.when}
                              </span>
                            </div>
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <div
                  style={css(
                    `display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--ag-surface-canvas);`,
                  )}
                >
                  <div
                    style={css(
                      `display:flex;height:40px;flex:0 0 auto;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--ag-shell-line);`,
                    )}
                  >
                    {configClosed && (
                      <>
                        <button
                          type={`button`}
                          aria-label={
                            configOpen
                              ? "Hide configuration"
                              : "Show configuration"
                          }
                          aria-expanded={configOpen}
                          onClick={toggleConfig}
                          aria-label={`Show configuration`}
                          style={css(
                            `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;border:none;background:transparent;cursor:default;color:var(--muted-foreground);`,
                          )}
                        >
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`2`}
                            strokeLinecap={`round`}
                            strokeLinejoin={`round`}
                            aria-hidden={`true`}
                          >
                            <path d={`m6 17 5-5-5-5M13 17l5-5-5-5`} />
                          </svg>
                        </button>
                      </>
                    )}
                    <div
                      className={`ag-scroll-x`}
                      style={css(
                        `display:flex;min-width:0;flex:1;align-items:center;overflow-x:auto;scrollbar-width:none;`,
                      )}
                    >
                      {tabs2.map((t, index7) => (
                        <Fragment key={index7}>
                          <button
                            type={`button`}
                            onClick={t.open}
                            style={css(t.style)}
                          >
                            <span
                              style={css(
                                `width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:${t.dot};`,
                              )}
                            ></span>
                            <span
                              style={css(
                                `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`,
                              )}
                            >
                              {t.ask}
                            </span>
                          </button>
                        </Fragment>
                      ))}
                      <span
                        style={css(
                          `display:inline-flex;width:28px;height:28px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                        )}
                      >
                        <svg
                          width={`14`}
                          height={`14`}
                          viewBox={`0 0 256 256`}
                          fill={`currentColor`}
                          aria-hidden={`true`}
                        >
                          <path
                            d={`M224 128a8 8 0 0 1-8 8h-80v80a8 8 0 0 1-16 0v-80H40a8 8 0 0 1 0-16h80V40a8 8 0 0 1 16 0v80h80a8 8 0 0 1 8 8Z`}
                          />
                        </svg>
                      </span>
                    </div>
                    <span
                      style={css(
                        `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                      )}
                    >
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 256 256`}
                        fill={`currentColor`}
                        aria-hidden={`true`}
                      >
                        <path
                          d={`M136 80v43.5l37.7 22.6a8 8 0 0 1-8.2 13.8l-41.6-25a8 8 0 0 1-3.9-6.9V80a8 8 0 0 1 16 0Zm88-48a8 8 0 0 0-8 8v22.6A104 104 0 0 0 33.6 79.4a8 8 0 0 0 14.1 7.5A88 88 0 0 1 205.1 68H192a8 8 0 0 0 0 16h32a8 8 0 0 0 8-8V40a8 8 0 0 0-8-8Zm-3.3 118.6a8 8 0 0 0-10 5.2A88 88 0 0 1 128 216a87.5 87.5 0 0 1-76.1-44l-3.3-6a8 8 0 1 0-14 7.7l3.3 6A104 104 0 0 0 225.9 160.7a8 8 0 0 0-5.2-10.1Z`}
                        />
                      </svg>
                    </span>
                    <span
                      style={css(
                        `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:6px;color:var(--muted-foreground);`,
                      )}
                    >
                      <svg
                        width={`14`}
                        height={`14`}
                        viewBox={`0 0 24 24`}
                        fill={`none`}
                        stroke={`currentColor`}
                        strokeWidth={`2`}
                        strokeLinecap={`round`}
                        strokeLinejoin={`round`}
                        aria-hidden={`true`}
                      >
                        <path d={`m11 17-5-5 5-5M18 17l-5-5 5-5`} />
                      </svg>
                    </span>
                  </div>
                  <div
                    style={css(
                      `flex:1;min-height:0;overflow-y:auto;padding:28px 24px 16px;`,
                    )}
                  >
                    <div
                      style={css(
                        `max-width:880px;margin:0 auto;display:flex;flex-direction:column;gap:22px;font:400 14px/1.5 var(--font-sans);`,
                      )}
                    >
                      <div
                        style={css(`display:flex;justify-content:flex-end;`)}
                      >
                        <div
                          style={css(
                            `max-width:70%;background:var(--ag-user-bubble-bg);border:1px solid var(--ag-user-bubble-border);border-radius:8px;padding:8px 12px;color:var(--foreground);`,
                          )}
                        >
                          {ss.ask}
                        </div>
                      </div>
                      <div
                        style={css(
                          `display:flex;flex-direction:column;gap:20px;`,
                        )}
                      >
                        <div>
                          <button
                            type={`button`}
                            aria-expanded={stepsOpen}
                            onClick={toggleSteps}
                            style={css(
                              `display:flex;align-items:center;gap:14px;padding:6px 0;border:none;background:transparent;cursor:default;width:fit-content;font:400 14px/1 var(--font-sans);color:var(--muted-foreground);`,
                            )}
                          >
                            {ss.worked}
                            <span
                              style={css(
                                `display:inline-flex;align-items:center;gap:8px;color:var(--placeholder);`,
                              )}
                            >
                              {`· `}
                              <span
                                style={css(
                                  `display:inline-flex;align-items:center;gap:5px;`,
                                )}
                              >
                                <svg
                                  width={`13`}
                                  height={`13`}
                                  viewBox={`0 0 256 256`}
                                  fill={`currentColor`}
                                  aria-hidden={`true`}
                                >
                                  <path
                                    d={`M213.7 82.3l-56-56A8 8 0 0 0 152 24H56a16 16 0 0 0-16 16v176a16 16 0 0 0 16 16h144a16 16 0 0 0 16-16V88a8 8 0 0 0-2.3-5.7ZM160 51.3 188.7 80H160ZM200 216H56V40h88v48a8 8 0 0 0 8 8h48Zm-32-80a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Zm0 32a8 8 0 0 1-8 8H96a8 8 0 0 1 0-16h64a8 8 0 0 1 8 8Z`}
                                  />
                                </svg>
                                {ss.files1}
                              </span>
                            </span>
                            <span
                              style={css(
                                `display:inline-flex;color:var(--placeholder);transform:${stepsRot};transition:transform .2s;`,
                              )}
                            >
                              <svg
                                width={`10`}
                                height={`10`}
                                viewBox={`0 0 256 256`}
                                fill={`currentColor`}
                                aria-hidden={`true`}
                              >
                                <path
                                  d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                                />
                              </svg>
                            </span>
                          </button>
                          {stepsOpen && (
                            <>
                              <div
                                style={css(
                                  `position:relative;margin:20px 0 6px;display:flex;flex-direction:column;gap:18px;`,
                                )}
                              >
                                <div
                                  aria-hidden={`true`}
                                  style={css(
                                    `position:absolute;left:11.5px;top:14px;bottom:14px;width:1px;background:var(--ag-colorBorderSecondary);`,
                                  )}
                                ></div>
                                {ss.steps.map((st, index11) => (
                                  <Fragment key={index11}>
                                    <div
                                      style={css(
                                        `display:flex;gap:14px;align-items:center;padding:3px 6px;margin-left:-6px;`,
                                      )}
                                    >
                                      <span
                                        style={css(
                                          `position:relative;z-index:1;width:24px;height:24px;flex:0 0 auto;border-radius:50%;background:var(--background);border:1px solid var(--ag-colorBorderSecondary);display:flex;align-items:center;justify-content:center;color:var(--muted-foreground);`,
                                        )}
                                      >
                                        <span style={css(st.logoStyle)}></span>
                                      </span>
                                      <span
                                        style={css(
                                          `color:var(--foreground);min-width:0;`,
                                        )}
                                      >
                                        {`${st.pre} `}
                                        <span style={css(`font-weight:500;`)}>
                                          {st.bold}
                                        </span>
                                        {` ${st.post}`}
                                      </span>
                                      <span
                                        style={css(
                                          `display:inline-flex;color:var(--placeholder);transform:rotate(90deg);margin-left:2px;`,
                                        )}
                                      >
                                        <svg
                                          width={`9`}
                                          height={`9`}
                                          viewBox={`0 0 256 256`}
                                          fill={`currentColor`}
                                          aria-hidden={`true`}
                                        >
                                          <path
                                            d={`m181.7 133.7-80 80a8 8 0 0 1-11.4-11.4L164.7 128 90.3 53.7a8 8 0 0 1 11.4-11.4l80 80a8 8 0 0 1 0 11.4Z`}
                                          />
                                        </svg>
                                      </span>
                                    </div>
                                  </Fragment>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                        <div
                          style={css(`color:var(--foreground);max-width:72ch;`)}
                        >
                          {ss.reply}
                        </div>
                        <div
                          style={css(
                            `display:flex;align-items:center;gap:10px;color:var(--placeholder);font:400 12px/1 var(--font-sans);`,
                          )}
                        >
                          <span>{ss.meta}</span>
                          <span>{`·`}</span>
                          <svg
                            width={`13`}
                            height={`13`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`1.6`}
                            strokeLinecap={`round`}
                            strokeLinejoin={`round`}
                          >
                            <rect
                              width={`14`}
                              height={`14`}
                              x={`8`}
                              y={`8`}
                              rx={`2`}
                            />
                            <path
                              d={`M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2`}
                            />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={css(`flex:0 0 auto;padding:0 24px 20px;`)}>
                    <div
                      style={css(
                        `max-width:880px;margin:0 auto;display:flex;flex-direction:column;min-height:72px;border-radius:12px;border:1px solid var(--ag-composer-border);background:var(--ag-surface-chat);box-shadow:var(--ag-surface-chat-shadow);`,
                      )}
                    >
                      <div
                        style={css(
                          `flex:1;padding:12px 14px;font:400 14px/20px var(--font-sans);color:var(--ag-composer-placeholder);`,
                        )}
                      >{`Message ${ss.title}…`}</div>
                      <div
                        style={css(
                          `display:flex;align-items:center;justify-content:flex-end;padding:0 8px 8px;`,
                        )}
                      >
                        <span
                          style={css(
                            `display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:999px;background:var(--ag-send-disabled-bg);color:var(--ag-send-disabled-fg);`,
                          )}
                        >
                          <svg
                            width={`14`}
                            height={`14`}
                            viewBox={`0 0 24 24`}
                            fill={`none`}
                            stroke={`currentColor`}
                            strokeWidth={`2.2`}
                            strokeLinecap={`round`}
                            strokeLinejoin={`round`}
                          >
                            <path d={`M12 19V5M5 12l7-7 7 7`} />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }
}
