import { useState, type CSSProperties } from "react";

/*
 * TemplateExplorer — the "An agent for every job" featured-template island.
 * Ported from the dark landing DC (templateSectionVals): a centered area-tab
 * pill row over one two-column featured panel (spec left, AGENTS.md right).
 * The Harness row is itself a segmented switch that swaps the model caption.
 * Rendered as a React island (client:visible).
 */

const CLOUD_URL = "https://cloud.agenta.ai/";

// Brand marks self-hosted under public/logos/tools/. The source SVGs are
// fill="currentColor" (they render black as <img>), so we tint them to the
// design's grey via a CSS mask — which also degrades to an empty box, never a
// broken-image icon, if a file is missing.
const LOGO_GREY = "#B9B8B6";
const LOGO: Record<string, string> = {
  GitHub: "/logos/tools/github.svg",
  Linear: "/logos/tools/linear.svg",
  Zendesk: "/logos/tools/zendesk.svg",
  Postgres: "/logos/tools/postgresql.svg",
  HubSpot: "/logos/tools/hubspot.svg",
  Slack: "/logos/tools/slack.svg",
  Notion: "/logos/tools/notion.svg",
  "Google Drive": "/logos/tools/googledrive.svg",
  PostHog: "/logos/tools/posthog.svg",
  Stripe: "/logos/tools/stripe.svg",
};

type Harness = { name: string; logo: string | null; soon?: boolean };
const HARNESSES: Harness[] = [
  { name: "Claude Code", logo: "/logos/tools/anthropic.svg" },
  { name: "Codex", logo: "/logos/tools/openai.svg", soon: false },
  { name: "pi.dev", logo: "/logos/tools/pidev.svg" },
];

// Model providers the agent can run on, shown icon-only (the row reads as a set
// of marks). "Self-hosted" is the one entry no single mark represents, so it
// keeps its text.
const MODELS: { name: string; logo: string }[] = [
  { name: "OpenAI", logo: "/logos/tools/openai.svg" },
  { name: "Anthropic", logo: "/logos/tools/anthropic.svg" },
  { name: "Gemini", logo: "/logos/tools/gemini.svg" },
  { name: "xAI", logo: "/logos/tools/xai.svg" },
];

type Template = {
  // Key from the app template registry (web/oss/.../agent-home/assets/templates.ts).
  // The app captures ?template=<key> on arrival and creates the agent from it.
  key: string;
  area: string;
  title: string;
  tagline: string;
  trigText: string;
  trigLogo: string | null;
  hDefault: number;
  skills: string[];
  tools: string[];
  agents: string;
};

const TEMPLATES: Template[] = [
  {
    key: "pr-reviewer",
    area: "Engineering",
    title: "Code review agent",
    tagline: "Reviews every pull request and leaves inline comments.",
    trigText: "On every pull request",
    trigLogo: LOGO.GitHub,
    hDefault: 0,
    skills: ["review-diff", "style-check", "risk-scan"],
    tools: ["GitHub", "Linear"],
    agents:
      "# Code review agent\n\nYou review pull requests for this repository. Be concise and specific. Never approve your own suggestions.\n\n## When triggered\nA pull request is opened or a new commit is pushed to an open PR.\n\n## Steps\n1. Read the PR title, description and linked Linear issue\n2. Review the full diff, file by file\n3. Summarize what changed and why, in 3 sentences max\n4. Flag bugs, security issues and perf regressions inline\n5. Suggest concrete, minimal fixes with code snippets\n\n## Rules\n- Comment only where you would block a merge\n- Prefer one high-signal comment over five nitpicks\n- Never rewrite whole files, propose diffs\n- Style issues: link the guide, do not lecture\n\n## Escalation\nTag the code owner when the diff touches auth, billing or migrations.",
  },
  {
    key: "support-triage",
    area: "Customer support",
    title: "Customer support agent",
    tagline: "Answers tickets from your docs and escalates the rest.",
    trigText: "On every new ticket",
    trigLogo: null,
    hDefault: 1,
    skills: ["classify", "answer"],
    tools: ["Zendesk", "Postgres"],
    agents:
      "# Support agent\n\nYou answer customer tickets strictly from the provided context. If the answer is not in the docs, say so.\n\n## When triggered\nA new ticket is created in Zendesk.\n\n## Steps\n1. Classify the ticket: how-to, bug, billing, security\n2. Search the docs and past resolved tickets\n3. Draft a reply in the customer’s language\n4. Cite the source doc for every claim\n5. Set the ticket priority based on impact\n\n## Rules\n- Never invent behavior the docs do not describe\n- Never share internal links or customer data\n- Keep replies under 150 words\n- One follow-up question max per reply\n\n## Escalation\nBilling and security tickets go to a human immediately, with your draft attached as an internal note.",
  },
  {
    key: "lead-qualifier",
    area: "Sales",
    title: "Lead research agent",
    tagline: "Researches inbound leads and drafts a first reply for review.",
    trigText: "On every new lead",
    trigLogo: null,
    hDefault: 0,
    skills: ["research-company", "score-fit", "draft-outreach"],
    tools: ["HubSpot", "Slack"],
    agents:
      "# Lead research agent\n\nYou research inbound leads and prepare a first reply. Nothing is sent without human approval.\n\n## When triggered\nA new lead is created in HubSpot.\n\n## Steps\n1. Research the company: size, industry, funding, stack\n2. Identify the contact’s role and likely use case\n3. Score fit against the ICP, 1 to 5, with reasons\n4. Draft a short first reply referencing their context\n5. Post the summary and draft to #sales in Slack\n\n## Rules\n- Facts only from public sources, cite each one\n- No pricing commitments in drafts\n- Below a fit score of 2, recommend a polite pass\n- Keep drafts under 120 words\n\n## Escalation\nEnterprise domains and existing customers go straight to the account owner.",
  },
  {
    key: "knowledge-chatbot",
    area: "Company knowledge",
    title: "Knowledge agent",
    tagline: "Answers team questions from your docs, wiki, and past threads.",
    trigText: "On every Slack mention",
    trigLogo: LOGO.Slack,
    hDefault: 1,
    skills: ["search-sources", "answer-cited"],
    tools: ["Notion", "Google Drive", "Slack"],
    agents:
      "# Knowledge agent\n\nYou answer team questions from company sources only. You are not a general assistant.\n\n## When triggered\nThe agent is mentioned in any Slack channel.\n\n## Steps\n1. Parse the question and identify the topic\n2. Search Notion, Google Drive and past threads\n3. Answer in the thread, short and direct\n4. Link every source you used\n5. If sources conflict, show both and say which is newer\n\n## Rules\n- If the answer is not in the sources, say so plainly\n- Never answer from general knowledge\n- Respect channel privacy, never quote private channels\n- Match the language of the question\n\n## Escalation\nQuestions about legal, HR or compensation get a pointer to the right human, not an answer.",
  },
  {
    key: "weekly-report",
    area: "Operations",
    title: "KPI dashboard agent",
    tagline: "Builds a weekly metrics dashboard and posts it to the team.",
    trigText: "Every Monday at 11:00",
    trigLogo: null,
    hDefault: 2,
    skills: ["pull-metrics", "build-dashboard", "publish"],
    tools: ["PostHog", "Stripe", "Slack"],
    agents:
      "# KPI dashboard agent\n\nYou build the weekly metrics dashboard. Numbers must reconcile with the source systems exactly.\n\n## When triggered\nEvery Monday at 11:00, Europe/Berlin.\n\n## Steps\n1. Pull last week from PostHog: signups, activation, retention\n2. Pull last week from Stripe: MRR, new revenue, churn\n3. Compare against the previous 4 weeks\n4. Flag any metric that moved more than 10%\n5. Publish the dashboard page to Notion\n6. Post a 5-line summary to #metrics in Slack\n\n## Rules\n- Never estimate a number you could not fetch, mark it missing\n- Week runs Monday to Sunday, UTC\n- Round to whole numbers, currencies to hundreds\n- Keep the summary under 80 words\n\n## Escalation\nIf a source API fails twice, ping the data owner instead of publishing a partial dashboard.",
  },
];

// Grey-tinted brand mark. Rendered as a masked box so any monochrome source SVG
// resolves to the design grey and a missing file degrades to an empty box.
function Logo({ src, size }: { src: string | null; size: number }) {
  if (!src) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        width: size,
        height: size,
        backgroundColor: LOGO_GREY,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
    />
  );
}

// Theme vars (--tplx-*) are defined on .ag-tplx in TemplateSection.astro:
// light per the light-theme spec, dark = the original literals.
const eyebrow: CSSProperties = {
  font: "var(--text-caption)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--tplx-eyebrow)",
};

// Small "Soon" tag shown in front of a not-yet-available harness option.
const soonBadge: CSSProperties = {
  font: "500 9px/1 var(--font-sans)",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--tplx-soon-text)",
  background: "var(--tplx-soon-bg)",
  padding: "3px 5px",
  borderRadius: 4,
};

export default function TemplateExplorer() {
  const [sel, setSel] = useState(0);
  // null → follow the current template's default harness.
  const [harness, setHarness] = useState<number | null>(null);

  const current = TEMPLATES[sel] ?? TEMPLATES[0];
  const hActive = harness ?? current.hDefault;

  return (
    <div
      className="ag-tplx"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 48,
        width: "100%",
      }}
    >
      {/* area tabs */}
      <div
        className="ag-tpl-tabs"
        role="tablist"
        aria-label="Template area"
        style={{
          display: "inline-flex",
          gap: 4,
          padding: 4,
          borderRadius: 12,
          background: "var(--tplx-tabs-bg)",
          border: "1px solid var(--tplx-tabs-border)",
          maxWidth: "calc(100% - 32px)",
        }}
      >
        {TEMPLATES.map((t, i) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={i === sel}
            onClick={() => {
              setSel(i);
              setHarness(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 36,
              padding: "0 16px",
              borderRadius: 8,
              border: "1px solid transparent",
              background: "transparent",
              cursor: "pointer",
              font: "var(--text-label)",
              whiteSpace: "nowrap",
              ...(i === sel
                ? {
                    background: "var(--tplx-tab-on-bg)",
                    borderColor: "var(--tplx-tab-on-border)",
                    boxShadow: "var(--tplx-tab-on-shadow)",
                    color: "var(--tplx-tab-on-text)",
                  }
                : { color: "var(--tplx-tab-text)" }),
            }}
          >
            {t.area}
          </button>
        ))}
      </div>

      {/* featured panel */}
      <div
        className="ag-tpl"
        style={{
          width: "min(1016px,100%)",
          borderRadius: 12,
          background: "var(--tplx-panel-bg)",
          boxShadow: "var(--tplx-panel-shadow)",
          display: "grid",
          gridTemplateColumns: "1fr 430px",
          overflow: "hidden",
          textAlign: "left",
          boxSizing: "border-box",
        }}
      >
        {/* left: spec */}
        <div
          className="ag-tpl-left"
          style={{
            padding: "34px 40px 30px",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          <span style={eyebrow}>{current.area}</span>
          {/* The selected template's name is an <h3> under TemplateSection's
              <h2>. marginBottom:0 pins the UA heading margin the inline styles
              would otherwise leave in place; marginTop stays as designed. */}
          <h3
            style={{
              font: "300 32px/1.15 var(--font-display,'GT Alpina',serif)",
              color: "var(--tplx-title)",
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            {current.title}
          </h3>
          <span
            style={{
              font: "var(--text-body-md)",
              color: "var(--tplx-tagline)",
              marginTop: 8,
            }}
          >
            {current.tagline}
          </span>

          <div
            className="ag-tpl-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "84px 1fr",
              columnGap: 20,
              rowGap: 0,
              alignItems: "center",
              marginTop: 24,
              borderTop: "1px solid var(--tplx-rule)",
            }}
          >
            {/* Trigger */}
            <span style={{ ...eyebrow, padding: "14px 0" }}>Trigger</span>
            <div style={{ padding: "10px 0" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  height: 32,
                  padding: "0 13px",
                  borderRadius: 8,
                  background: "var(--tplx-trig-bg)",
                  boxShadow: "inset 0 0 0 1px var(--tplx-trig-ring)",
                  font: "var(--text-label)",
                  color: "var(--tplx-trig-text)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--tplx-trig-dot)",
                    boxShadow: "var(--tplx-trig-dot-glow)",
                  }}
                />
                <Logo src={current.trigLogo} size={15} />
                {current.trigText}
              </span>
            </div>

            {/* Harness */}
            <span
              style={{
                ...eyebrow,
                padding: "14px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              Harness
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "10px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  // Wrap so the 3-option switch can't overflow a narrow (~335px)
                  // mobile panel and clip "pi.dev"; stays one row where it fits.
                  flexWrap: "wrap",
                  gap: 3,
                  padding: 3,
                  borderRadius: 9,
                  background: "var(--tplx-seg-bg)",
                  boxShadow: "inset 0 0 0 1px var(--tplx-seg-ring)",
                }}
              >
                {HARNESSES.map((h, i) => (
                  <button
                    key={h.name}
                    type="button"
                    aria-pressed={i === hActive}
                    onClick={() => setHarness(i)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      height: 28,
                      padding: "0 12px",
                      borderRadius: 7,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                      font: "var(--text-label)",
                      whiteSpace: "nowrap",
                      ...(i === hActive
                        ? {
                            background: "var(--tplx-seg-on-bg)",
                            boxShadow: "var(--tplx-seg-on-shadow)",
                            color: "var(--tplx-seg-on-text)",
                          }
                        : { color: "var(--tplx-seg-text)" }),
                    }}
                  >
                    {h.soon && <span style={soonBadge}>Soon</span>}
                    <Logo src={h.logo} size={13} />
                    {h.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Models */}
            <span
              style={{
                ...eyebrow,
                padding: "14px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              Models
            </span>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                padding: "10px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              {MODELS.map((m) => (
                <span
                  key={m.name}
                  role="img"
                  aria-label={m.name}
                  title={m.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 28,
                    borderRadius: 8,
                    background: "var(--tplx-chip-bg)",
                    boxShadow: "var(--tplx-chip-shadow)",
                  }}
                >
                  <Logo src={m.logo} size={16} />
                </span>
              ))}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 28,
                  padding: "0 11px",
                  borderRadius: 8,
                  background: "var(--tplx-chip-bg)",
                  boxShadow: "var(--tplx-chip-shadow)",
                  font: "var(--text-label)",
                  color: "var(--tplx-chip-text)",
                }}
              >
                Self-hosted
              </span>
            </div>

            {/* Skills */}
            <span
              style={{
                ...eyebrow,
                padding: "14px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              Skills
            </span>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              {current.skills.map((sk) => (
                <span
                  key={sk}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 28,
                    padding: "0 11px",
                    borderRadius: 8,
                    background: "var(--tplx-skill-bg)",
                    boxShadow: "inset 0 0 0 1px var(--tplx-skill-ring)",
                    font: "var(--app-text-mono)",
                    color: "var(--tplx-skill-text)",
                  }}
                >
                  {sk}
                </span>
              ))}
            </div>

            {/* Tools */}
            <span
              style={{
                ...eyebrow,
                padding: "14px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              Tools
            </span>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                padding: "10px 0",
                borderTop: "1px solid var(--tplx-rule-soft)",
              }}
            >
              {current.tools.map((tl) => (
                <span
                  key={tl}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    height: 28,
                    padding: "0 11px",
                    borderRadius: 8,
                    background: "var(--tplx-chip-bg)",
                    boxShadow: "var(--tplx-chip-shadow)",
                    font: "var(--text-label)",
                    color: "var(--tplx-chip-text)",
                  }}
                >
                  <Logo src={LOGO[tl] ?? null} size={14} />
                  {tl}
                </span>
              ))}
            </div>
          </div>

          {/* CTA */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "auto",
              paddingTop: 22,
            }}
          >
            <a
              className="ag-btn ag-btn--primary"
              href={`${CLOUD_URL}?template=${current.key}`}
              target="_blank"
              rel="noopener"
            >
              Use this template
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
        </div>

        {/* right: AGENTS.md viewer */}
        <div
          className="ag-tpl-md"
          style={{
            background: "var(--tplx-md-bg)",
            borderLeft: "1px solid var(--tplx-md-border)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--tplx-md-hdr-border)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "var(--tplx-md-dot)",
              }}
            />
            <span
              style={{
                font: "var(--app-text-mono)",
                fontSize: 11,
                color: "var(--tplx-md-name)",
              }}
            >
              AGENTS.md
            </span>
          </div>
          <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
            <pre
              className="ag-tpl-md-scroll"
              style={{
                position: "absolute",
                inset: 0,
                margin: 0,
                padding: "20px 22px",
                font: "var(--app-text-mono)",
                color: "var(--tplx-md-text)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.75,
                overflow: "auto",
                boxSizing: "border-box",
              }}
            >
              {current.agents}
            </pre>
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: 44,
                background: "var(--tplx-md-fade)",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
