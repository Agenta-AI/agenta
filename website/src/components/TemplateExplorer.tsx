import { useState, type CSSProperties } from "react";

/*
 * TemplateExplorer — the "Build agents using skills and tools" interactive box.
 * Ported 1:1 from the dark landing DC (TEMPLATES data + selection/accordion
 * logic). Rendered as a React island (client:visible) — this is the first
 * proof that Astro islands work in the new stack.
 */

const GET_STARTED = "https://cloud.agenta.ai/";

type Skill = { name: string; summary: string; steps: string[] };
type Tool = {
  id: string;
  name: string;
  mono: string;
  desc: string;
  auth: string;
  actions: string[];
};
type Template = {
  // Key from the app template registry (web/oss/.../agent-home/assets/templates.ts). The app
  // captures ?template=<key> on arrival and creates the agent from that template.
  key: string;
  title: string;
  tagline: string;
  mono: string;
  triggerShort: string;
  trigger: string;
  harness: string;
  harnessMono: string;
  agents: string;
  skills: Skill[];
  tools: Tool[];
};

const TEMPLATES: Template[] = [
  {
    key: "pr-reviewer",
    title: "Code review agent",
    tagline: "Reviews every pull request and leaves inline comments.",
    mono: "</>",
    triggerShort: "On GitHub PR opened",
    trigger: "GitHub — pull request opened",
    harness: "Claude Code",
    harnessMono: "C",
    agents:
      "# Code review agent\n\nReview the PR diff and be concise.\n- Summarize what changed and why\n- Flag bugs, security and perf issues\n- Suggest concrete, minimal fixes",
    skills: [
      {
        name: "review-diff",
        summary: "Summarize what a PR changes",
        steps: [
          "Read the unified diff",
          "Group changes by file and intent",
          "Write a 2–3 sentence summary",
        ],
      },
      {
        name: "style-check",
        summary: "Enforce conventions & lint rules",
        steps: [
          "Load the repo style guide",
          "Compare against changed lines only",
          "Comment on real violations",
        ],
      },
      {
        name: "risk-scan",
        summary: "Flag bugs, security & perf risks",
        steps: [
          "Scan for unsafe patterns",
          "Check inputs and error handling",
          "Rank findings by severity",
        ],
      },
    ],
    tools: [
      {
        id: "github",
        name: "GitHub",
        mono: "G",
        desc: "Read PRs and files, post review comments.",
        auth: "oauth",
        actions: ["get_pull_request", "list_files", "create_review_comment"],
      },
      {
        id: "linear",
        name: "Linear",
        mono: "L",
        desc: "Link PRs to issues and update status.",
        auth: "api_key",
        actions: ["get_issue", "update_issue"],
      },
    ],
  },
  {
    key: "weekly-report",
    title: "KPI dashboard agent",
    tagline: "Builds a weekly metrics dashboard and posts it to the team.",
    mono: "▦",
    triggerShort: "Every Monday at 11:00",
    trigger: "Schedule — every Monday at 11:00",
    harness: "pi.dev",
    harnessMono: "π",
    agents:
      "# KPI dashboard agent\n\nEvery Monday, gather last week’s numbers.\n- PostHog: activation, retention\n- Stripe: MRR, churn\n- Publish to Notion, ping #metrics in Slack",
    skills: [
      {
        name: "pull-metrics",
        summary: "Gather product & revenue metrics",
        steps: [
          "Query PostHog for activation & retention",
          "Query Stripe for MRR & churn",
          "Normalize into a weekly snapshot",
        ],
      },
      {
        name: "build-dashboard",
        summary: "Compose the dashboard",
        steps: [
          "Pick a chart per metric",
          "Add week-over-week deltas",
          "Render to a shareable doc",
        ],
      },
      {
        name: "publish",
        summary: "Publish & notify the team",
        steps: [
          "Push the doc to Notion",
          "Post a summary to #metrics",
          "Attach the dashboard link",
        ],
      },
    ],
    tools: [
      {
        id: "posthog",
        name: "PostHog",
        mono: "P",
        desc: "Query product analytics events and funnels.",
        auth: "api_key",
        actions: ["query_events", "get_funnel", "get_retention"],
      },
      {
        id: "stripe",
        name: "Stripe",
        mono: "S",
        desc: "Read revenue, subscriptions and churn.",
        auth: "api_key",
        actions: ["list_subscriptions", "get_mrr"],
      },
      {
        id: "slack",
        name: "Slack",
        mono: "#",
        desc: "Post messages and dashboards to channels.",
        auth: "oauth",
        actions: ["post_message", "upload_file"],
      },
    ],
  },
  {
    key: "error-triage",
    title: "Production bug agent",
    tagline: "Triages Sentry alerts and opens a fix PR with context.",
    mono: "!",
    triggerShort: "On Sentry alert",
    trigger: "Sentry — new issue alert",
    harness: "Claude Code",
    harnessMono: "C",
    agents:
      "# Production bug agent\n\nOn a new Sentry issue.\n- Read the stack trace & breadcrumbs\n- Search the codebase for the cause\n- Propose a minimal, tested fix",
    skills: [
      {
        name: "reproduce",
        summary: "Reproduce from the stack trace",
        steps: [
          "Parse the Sentry stack trace",
          "Identify the failing call path",
          "Write a minimal repro",
        ],
      },
      {
        name: "root-cause",
        summary: "Locate the root cause",
        steps: [
          "Search the codebase for the frame",
          "Inspect recent changes",
          "Confirm the faulty assumption",
        ],
      },
      {
        name: "propose-fix",
        summary: "Draft a minimal fix & PR",
        steps: [
          "Write the smallest safe change",
          "Add a regression test",
          "Open a PR with context",
        ],
      },
    ],
    tools: [
      {
        id: "sentry",
        name: "Sentry",
        mono: "S",
        desc: "Read issues, events and stack traces.",
        auth: "oauth",
        actions: ["get_issue", "list_events", "resolve_issue"],
      },
      {
        id: "github",
        name: "GitHub",
        mono: "G",
        desc: "Search code and open pull requests.",
        auth: "oauth",
        actions: ["search_code", "create_pull_request"],
      },
    ],
  },
  {
    key: "support-triage",
    title: "Customer support agent",
    tagline: "Answers tickets from your docs and escalates the rest.",
    mono: "?",
    triggerShort: "On Slack / Zendesk ticket",
    trigger: "Slack / Zendesk — new ticket",
    harness: "Codex",
    harnessMono: "O",
    agents:
      "# Support agent\n\nAnswer strictly from the provided context.\n- Always cite the source doc\n- Escalate billing & security to a human",
    skills: [
      {
        name: "classify",
        summary: "Classify the incoming request",
        steps: [
          "Detect intent & urgency",
          "Route billing / security to humans",
          "Tag the ticket",
        ],
      },
      {
        name: "answer",
        summary: "Draft a grounded reply",
        steps: [
          "Search the knowledge base",
          "Answer only from sources",
          "Cite the doc used",
        ],
      },
    ],
    tools: [
      {
        id: "zendesk",
        name: "Zendesk",
        mono: "Z",
        desc: "Read and reply to support tickets.",
        auth: "oauth",
        actions: ["get_ticket", "reply_ticket", "tag_ticket"],
      },
      {
        id: "postgres",
        name: "Postgres",
        mono: "▢",
        desc: "Look up orders and account data.",
        auth: "connection_string",
        actions: ["query"],
      },
    ],
  },
  {
    key: "changelog-writer",
    title: "Release notes agent",
    tagline: "Turns merged PRs into customer-ready release notes.",
    mono: "¶",
    triggerShort: "On GitHub release tagged",
    trigger: "GitHub — release tagged",
    harness: "Codex",
    harnessMono: "O",
    agents:
      "# Release notes agent\n\nSummarize what shipped this release.\n- Group: Features, Fixes, Chores\n- Plain language, benefit-first\n- Link each item to its PR",
    skills: [
      {
        name: "collect-prs",
        summary: "Collect merged PRs since last tag",
        steps: [
          "List merged PRs",
          "Filter by milestone",
          "Extract titles & labels",
        ],
      },
      {
        name: "write-notes",
        summary: "Write user-facing notes",
        steps: [
          "Group by Features / Fixes / Chores",
          "Rewrite in plain language",
          "Link each item to its PR",
        ],
      },
    ],
    tools: [
      {
        id: "github",
        name: "GitHub",
        mono: "G",
        desc: "Read merged PRs and release tags.",
        auth: "oauth",
        actions: ["list_pull_requests", "get_release"],
      },
      {
        id: "notion",
        name: "Notion",
        mono: "N",
        desc: "Publish the changelog page.",
        auth: "oauth",
        actions: ["create_page", "update_page"],
      },
    ],
  },
];

const skillCode = (sk: Skill) =>
  "---\nname: " +
  sk.name +
  "\ndescription: " +
  sk.summary +
  "\n---\n\n## Instructions\n\n" +
  sk.steps.map((s) => "- " + s).join("\n");

const toolCode = (t: Tool) =>
  JSON.stringify(
    { name: t.id, description: t.desc, auth: t.auth, actions: t.actions },
    null,
    2,
  );

const chev = (open: boolean): CSSProperties => ({
  transform: open ? "rotate(90deg)" : "rotate(0deg)",
  transition: "transform 0.18s ease",
  flex: "0 0 auto",
});

const fileBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};
const codeBlock: CSSProperties = {
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
  background: "rgba(0,0,0,0.34)",
};
const pre: CSSProperties = {
  margin: 0,
  padding: "13px 14px",
  font: "var(--app-text-mono)",
  color: "rgba(255,255,255,0.7)",
  whiteSpace: "pre-wrap",
  lineHeight: 1.6,
};

export default function TemplateExplorer() {
  const [selected, setSelected] = useState(0);
  const [skillOpen, setSkillOpen] = useState(0);
  const [toolOpen, setToolOpen] = useState(-1);
  const [sec, setSec] = useState({ skills: true, agents: false, tools: false });

  const current = TEMPLATES[selected] ?? TEMPLATES[0];

  return (
    <div
      className="ag-explorer"
      style={{
        width: "min(1016px,100%)",
        height: 520,
        borderRadius: 12,
        background: "#121113",
        boxShadow:
          "0 24px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07)",
        display: "flex",
        overflow: "hidden",
        textAlign: "left",
      }}
    >
      {/* left: clickable use cases */}
      <div
        data-scroll="dark"
        className="ag-explorer-list"
        style={{
          width: 368,
          flex: "0 0 368px",
          background: "rgba(255,255,255,0.02)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflow: "auto",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            font: "var(--text-caption)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.36)",
            padding: "2px 6px 6px",
          }}
        >
          Use cases
        </span>
        {TEMPLATES.map((t, i) => (
          <div
            key={t.title}
            onClick={() => {
              setSelected(i);
              setSkillOpen(0);
              setToolOpen(-1);
            }}
            style={{
              padding: "13px 14px",
              borderRadius: 10,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              transition: "background 0.12s",
              background:
                i === selected
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(255,255,255,0.015)",
              boxShadow:
                i === selected
                  ? "inset 0 0 0 1px rgba(255,255,255,0.14)"
                  : "inset 0 0 0 1px rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span
                style={{
                  flex: "0 0 auto",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.07)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: "600 13px/1 var(--font-sans)",
                  color:
                    i === selected
                      ? "var(--yellow-400)"
                      : "rgba(255,255,255,0.85)",
                }}
              >
                {t.mono}
              </span>
              <span style={{ font: "var(--text-label)", color: "#F7F6F4" }}>
                {t.title}
              </span>
            </div>
            <span
              style={{
                font: "var(--text-caption)",
                color: "rgba(255,255,255,0.5)",
                paddingLeft: 41,
              }}
            >
              {t.triggerShort}
            </span>
          </div>
        ))}
      </div>

      {/* right: selected template detail */}
      <div
        data-scroll="dark"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span
              style={{
                font: "300 24px/1.1 var(--font-display)",
                color: "#F7F6F4",
              }}
            >
              {current.title}
            </span>
            <span
              style={{
                font: "var(--text-body-sm)",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              {current.tagline}
            </span>
          </div>
          <a
            href={`${GET_STARTED}?template=${current.key}`}
            target="_blank"
            rel="noopener"
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 34,
              padding: "0 16px",
              borderRadius: 8,
              background: "var(--grad-btn-primary)",
              boxShadow: "var(--shadow-btn-primary)",
              color: "var(--ink-900)",
              font: "var(--text-label)",
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            Use template
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 2.5 6.5 6 3 9.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </div>

        {/* trigger + harness */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.025)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
          }}
        >
          <span
            style={{
              font: "var(--text-caption)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.34)",
            }}
          >
            Trigger
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 30,
              padding: "0 12px",
              borderRadius: 8,
              background: "rgba(242,242,92,0.1)",
              boxShadow: "inset 0 0 0 1px rgba(242,242,92,0.25)",
              font: "var(--text-label)",
              color: "#F7F6F4",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--yellow-400)",
                boxShadow: "0 0 8px rgba(242,242,92,0.7)",
              }}
            />
            {current.trigger}
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 11px 0 8px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.05)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
              font: "var(--text-label)",
              color: "rgba(255,255,255,0.82)",
            }}
          >
            <span
              style={{
                width: 19,
                height: 19,
                borderRadius: 5,
                background: "rgba(255,255,255,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "600 10px/1 var(--font-sans)",
                color: "rgba(255,255,255,0.88)",
              }}
            >
              {current.harnessMono}
            </span>
            {current.harness}
          </span>
        </div>

        {/* Skills */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.07)",
            paddingTop: 6,
          }}
        >
          <div
            onClick={() => setSec((s) => ({ ...s, skills: !s.skills }))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={chev(sec.skills)}
            >
              <path
                d="M4 2.5 8 6l-4 3.5"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ font: "var(--text-label)", color: "#F7F6F4" }}>
              Skills
            </span>
            <span
              style={{
                font: "var(--app-text-mono)",
                fontSize: 11,
                color: "rgba(255,255,255,0.42)",
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              {current.skills.length}
            </span>
          </div>
          {sec.skills && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "6px 0 2px",
                animation: "accordion-in 0.2s ease both",
              }}
            >
              {current.skills.map((sk, i) => (
                <div
                  key={sk.name}
                  style={{
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.025)",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    onClick={() => setSkillOpen((p) => (p === i ? -1 : i))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "11px 13px",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      style={chev(skillOpen === i)}
                    >
                      <path
                        d="M4 2.5 8 6l-4 3.5"
                        stroke="rgba(255,255,255,0.45)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: "rgba(217,119,87,0.16)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "var(--terracotta-500)",
                        }}
                      />
                    </span>
                    <span
                      style={{
                        flex: "0 0 auto",
                        font: "var(--app-text-mono)",
                        color: "#F7F6F4",
                      }}
                    >
                      {sk.name}
                    </span>
                    <span
                      style={{
                        minWidth: 0,
                        font: "var(--text-caption)",
                        color: "rgba(255,255,255,0.45)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sk.summary}
                    </span>
                  </div>
                  {skillOpen === i && (
                    <div
                      style={{
                        padding: "0 13px 13px 35px",
                        animation: "accordion-in 0.2s ease both",
                      }}
                    >
                      <div style={codeBlock}>
                        <div style={fileBar}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "rgba(255,255,255,0.14)",
                            }}
                          />
                          <span
                            style={{
                              font: "var(--app-text-mono)",
                              fontSize: 11,
                              color: "rgba(255,255,255,0.5)",
                            }}
                          >
                            skills/{sk.name}/SKILL.md
                          </span>
                        </div>
                        <pre style={pre}>{skillCode(sk)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agents.md */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.07)",
            paddingTop: 6,
          }}
        >
          <div
            onClick={() => setSec((s) => ({ ...s, agents: !s.agents }))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={chev(sec.agents)}
            >
              <path
                d="M4 2.5 8 6l-4 3.5"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ font: "var(--text-label)", color: "#F7F6F4" }}>
              Agents.md
            </span>
          </div>
          {sec.agents && (
            <div
              style={{
                padding: "6px 0 2px",
                animation: "accordion-in 0.2s ease both",
              }}
            >
              <div style={codeBlock}>
                <div style={fileBar}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.14)",
                    }}
                  />
                  <span
                    style={{
                      font: "var(--app-text-mono)",
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    AGENTS.md
                  </span>
                </div>
                <pre style={pre}>{current.agents}</pre>
              </div>
            </div>
          )}
        </div>

        {/* Tools */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.07)",
            paddingTop: 6,
          }}
        >
          <div
            onClick={() => setSec((s) => ({ ...s, tools: !s.tools }))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              style={chev(sec.tools)}
            >
              <path
                d="M4 2.5 8 6l-4 3.5"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span style={{ font: "var(--text-label)", color: "#F7F6F4" }}>
              Tools
            </span>
            <span
              style={{
                font: "var(--app-text-mono)",
                fontSize: 11,
                color: "rgba(255,255,255,0.42)",
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              {current.tools.length}
            </span>
          </div>
          {sec.tools && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "6px 0 2px",
                animation: "accordion-in 0.2s ease both",
              }}
            >
              {current.tools.map((tl, i) => (
                <div
                  key={tl.id}
                  style={{
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.025)",
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.07)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    onClick={() => setToolOpen((p) => (p === i ? -1 : i))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 11,
                      padding: "11px 13px",
                      cursor: "pointer",
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 12 12"
                      fill="none"
                      style={chev(toolOpen === i)}
                    >
                      <path
                        d="M4 2.5 8 6l-4 3.5"
                        stroke="rgba(255,255,255,0.45)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      style={{
                        flex: "0 0 auto",
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.07)",
                        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        font: "600 11px/1 var(--font-sans)",
                        color: "rgba(255,255,255,0.85)",
                      }}
                    >
                      {tl.mono}
                    </span>
                    <span
                      style={{
                        flex: "0 0 auto",
                        font: "var(--text-label)",
                        color: "#F7F6F4",
                      }}
                    >
                      {tl.name}
                    </span>
                    <span
                      style={{
                        minWidth: 0,
                        font: "var(--text-caption)",
                        color: "rgba(255,255,255,0.45)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tl.desc}
                    </span>
                  </div>
                  {toolOpen === i && (
                    <div
                      style={{
                        padding: "0 13px 13px 35px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        animation: "accordion-in 0.2s ease both",
                      }}
                    >
                      <span
                        style={{
                          font: "var(--text-body-sm)",
                          color: "rgba(255,255,255,0.6)",
                        }}
                      >
                        {tl.desc}
                      </span>
                      <div style={codeBlock}>
                        <div style={fileBar}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "rgba(255,255,255,0.14)",
                            }}
                          />
                          <span
                            style={{
                              font: "var(--app-text-mono)",
                              fontSize: 11,
                              color: "rgba(255,255,255,0.5)",
                            }}
                          >
                            {tl.id}.tool.json
                          </span>
                        </div>
                        <pre style={pre}>{toolCode(tl)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
