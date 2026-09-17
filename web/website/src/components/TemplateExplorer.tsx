import { useId, useState, type CSSProperties, type KeyboardEvent } from "react";

const CLOUD_URL = "https://cloud.agenta.ai/";

const LOGOS: Record<string, string> = {
  GitHub: "/logos/tools/github.svg",
  HubSpot: "/logos/tools/hubspot.svg",
  Linear: "/logos/tools/linear.svg",
  Notion: "/logos/tools/notion.svg",
  Slack: "/logos/tools/slack.svg",
  Zendesk: "/logos/tools/zendesk.svg",
};

type VisualKind = "timeline" | "checks" | "chat" | "bars";

type Template = {
  title: string;
  description: string;
  tools: string[];
  visual: [string, string, string, string];
};

type Area = {
  name: string;
  templates: Template[];
};

const AREAS: Area[] = [
  {
    name: "Marketing",
    templates: [
      {
        title: "SEO automation agent",
        description:
          "Turns an article idea into a brief, a draft, and a pull request ready for review.",
        tools: ["Notion", "GitHub"],
        visual: [
          "Research the topic",
          "Compare six sources",
          "Prepare the brief",
          "Ready in Notion",
        ],
      },
      {
        title: "SEO content generator",
        description:
          "Drafts long-form articles from an approved brief, in your voice, with sources linked.",
        tools: ["Notion", "GitHub"],
        visual: [
          "Read the brief",
          "Match your voice",
          "Link every source",
          "Open a pull request",
        ],
      },
      {
        title: "GEO optimization agent",
        description:
          "Checks how AI assistants describe your product and proposes content fixes.",
        tools: ["Notion", "GitHub"],
        visual: [
          "How is Agenta described?",
          "Across twelve tracked prompts.",
          "Positioning gaps found",
          "Share the report",
        ],
      },
      {
        title: "AI marketing agent",
        description:
          "Plans the weekly content calendar and drafts social posts from what shipped.",
        tools: ["GitHub", "Notion"],
        visual: ["5 posts", "3 posts", "1 post", "Calendar updated"],
      },
      {
        title: "Competitor mention tracker",
        description:
          "Watches for competitor mentions and summarizes what changed, daily.",
        tools: ["Slack", "Notion"],
        visual: [
          "Scan new mentions",
          "Check product changes",
          "Summarize the signal",
          "Post the digest",
        ],
      },
      {
        title: "Ad campaign analysis",
        description:
          "Pulls campaign performance and flags what to pause or scale.",
        tools: ["HubSpot", "Slack"],
        visual: [
          "Pull campaign data",
          "Compare cost per lead",
          "Flag the outliers",
          "Share recommendations",
        ],
      },
    ],
  },
  {
    name: "Sales",
    templates: [
      {
        title: "Outreach coworker",
        description:
          "Researches prospects, gathers context, and drafts outreach for your review.",
        tools: ["HubSpot", "Slack"],
        visual: [
          "Research the prospect",
          "Find recent context",
          "Draft the introduction",
          "Ready for review",
        ],
      },
      {
        title: "Lead qualification agent",
        description:
          "Scores inbound leads against your ICP and routes them to the right owner.",
        tools: ["HubSpot", "Slack"],
        visual: [
          "Read new leads",
          "Research company fit",
          "Score against your ICP",
          "Route qualified leads",
        ],
      },
      {
        title: "CRM hygiene agent",
        description:
          "Keeps deals, stages, and contacts in your CRM current after every call.",
        tools: ["Slack", "HubSpot"],
        visual: [
          "Update yesterday’s calls",
          "Six deals updated.",
          "Two contacts added",
          "Review in HubSpot",
        ],
      },
      {
        title: "Pipeline review agent",
        description:
          "Summarizes pipeline health and surfaces deals at risk before the weekly review.",
        tools: ["HubSpot", "Slack"],
        visual: ["18 deals", "7 active", "3 at risk", "Pipeline reviewed"],
      },
      {
        title: "Proposal drafting agent",
        description:
          "Turns discovery notes into a first-draft proposal using your templates.",
        tools: ["Notion", "HubSpot"],
        visual: [
          "Read discovery notes",
          "Apply your template",
          "Draft the scope",
          "Proposal ready",
        ],
      },
    ],
  },
  {
    name: "Support",
    templates: [
      {
        title: "Support coworker",
        description:
          "Uses your company knowledge to draft replies and brings uncertain cases back to you.",
        tools: ["Zendesk", "Notion"],
        visual: [
          "Read the ticket",
          "Search the docs",
          "Draft a sourced reply",
          "Ask for review",
        ],
      },
      {
        title: "Ticket triage agent",
        description:
          "Classifies and prioritizes new tickets, and routes them to the right queue.",
        tools: ["Zendesk", "Slack"],
        visual: [
          "Read new tickets",
          "Tag urgency",
          "Route to an owner",
          "Escalate urgent cases",
        ],
      },
      {
        title: "Knowledge base agent",
        description:
          "Spots repeated questions and drafts new help-center articles from resolved tickets.",
        tools: ["Zendesk", "Notion"],
        visual: [
          "What is missing from our docs?",
          "Two repeated questions found.",
          "Articles drafted",
          "Review in Notion",
        ],
      },
      {
        title: "Bug report agent",
        description:
          "Turns customer bug reports into reproducible engineering issues.",
        tools: ["Zendesk", "Linear"],
        visual: ["23 tickets", "8 bugs", "2 urgent", "Issues created"],
      },
      {
        title: "Customer health agent",
        description:
          "Watches account signals and warns you before a customer churns.",
        tools: ["Zendesk", "HubSpot"],
        visual: [
          "Watch account signals",
          "Compare support load",
          "Check renewal dates",
          "Flag at-risk accounts",
        ],
      },
    ],
  },
  {
    name: "Engineering",
    templates: [
      {
        title: "Code review coworker",
        description:
          "Reviews changes against your team’s conventions and surfaces issues with file references.",
        tools: ["GitHub", "Linear"],
        visual: [
          "Read the pull request",
          "Check team conventions",
          "Review edge cases",
          "Leave inline comments",
        ],
      },
      {
        title: "Issue triage agent",
        description:
          "Labels and groups new GitHub issues, and flags duplicates.",
        tools: ["GitHub", "Linear"],
        visual: [
          "Read open issues",
          "Find duplicates",
          "Group by area",
          "Update the backlog",
        ],
      },
      {
        title: "Release notes agent",
        description:
          "Writes the changelog from merged pull requests, in your format.",
        tools: ["GitHub", "Notion"],
        visual: [
          "Draft this week’s changelog",
          "27 pull requests read.",
          "Breaking changes found",
          "Open the draft",
        ],
      },
      {
        title: "On-call summary agent",
        description:
          "Summarizes incidents and error traces for the morning hand-off.",
        tools: ["Slack", "GitHub"],
        visual: ["12 alerts", "3 incidents", "1 unresolved", "Hand-off posted"],
      },
      {
        title: "Dependency update agent",
        description:
          "Checks for outdated or vulnerable dependencies and opens upgrade PRs.",
        tools: ["GitHub", "Slack"],
        visual: [
          "Scan dependencies",
          "Check advisories",
          "Run the test suite",
          "Open upgrade PRs",
        ],
      },
    ],
  },
];

function ToolLogo({ name }: { name: string }) {
  const src = LOGOS[name];

  if (!src) {
    return (
      <svg
        className="ag-tplv-tool-logo"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9S14.4 18.4 12 21c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  return (
    <span
      className="ag-tplv-tool-logo"
      aria-hidden="true"
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
      }}
    />
  );
}

function TimelineVisual({ template }: { template: Template }) {
  return (
    <div className="ag-tplv-timeline">
      <span className="ag-tplv-pill">
        <ToolLogo name={template.tools[0]} />
        {template.visual[0]}
      </span>
      <span className="ag-tplv-step">
        <b>1</b>
        {template.visual[1]}
      </span>
      <span className="ag-tplv-step">
        <b>2</b>
        {template.visual[2]}
      </span>
      <span className="ag-tplv-pill ag-tplv-pill--accent">
        <ToolLogo name={template.tools[1] ?? template.tools[0]} />
        {template.visual[3]}
      </span>
    </div>
  );
}

function ChecksVisual({ template }: { template: Template }) {
  return (
    <div className="ag-tplv-checks">
      {template.visual.map((item, index) => (
        <span
          className={index === 1 || index === 2 ? "is-active" : ""}
          key={item}
        >
          <i />
          {item}
        </span>
      ))}
    </div>
  );
}

function ChatVisual({ template }: { template: Template }) {
  return (
    <div className="ag-tplv-chat">
      <span>{template.visual[0]}</span>
      <span className="ag-tplv-chat-reply">{template.visual[1]}</span>
      <span className="ag-tplv-pill">
        <ToolLogo name={template.tools[0]} />
        {template.visual[2]}
      </span>
    </div>
  );
}

function BarsVisual({ template }: { template: Template }) {
  return (
    <div className="ag-tplv-bars">
      <div>
        {template.visual.slice(0, 3).map((item, index) => (
          <span className={index === 2 ? "is-active" : ""} key={item}>
            {item}
            <i />
          </span>
        ))}
      </div>
      <span className="ag-tplv-pill">
        <ToolLogo name={template.tools[0]} />
        {template.visual[3]}
      </span>
    </div>
  );
}

function TemplateVisual({
  template,
  kind,
}: {
  template: Template;
  kind: VisualKind;
}) {
  if (kind === "checks") return <ChecksVisual template={template} />;
  if (kind === "chat") return <ChatVisual template={template} />;
  if (kind === "bars") return <BarsVisual template={template} />;
  return <TimelineVisual template={template} />;
}

function pickTint(title: string, index: number, picks: number[]) {
  let hash = 0;
  for (const character of title)
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;

  let tint = hash % 4;
  const left = index % 4 ? picks[index - 1] : -1;
  const above = index >= 4 ? picks[index - 4] : -1;
  for (
    let guard = 0;
    guard < 4 && (tint === left || tint === above);
    guard += 1
  ) {
    tint = (tint + 1) % 4;
  }
  picks[index] = tint;
  return tint + 1;
}

export default function TemplateExplorer() {
  const [selectedArea, setSelectedArea] = useState(0);
  const id = useId();
  const area = AREAS[selectedArea] ?? AREAS[0];
  const tintPicks: number[] = [];

  const selectFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let next = index;
    if (event.key === "ArrowLeft")
      next = (index - 1 + AREAS.length) % AREAS.length;
    if (event.key === "ArrowRight") next = (index + 1) % AREAS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = AREAS.length - 1;

    setSelectedArea(next);
    requestAnimationFrame(() =>
      document.getElementById(`${id}-tab-${next}`)?.focus(),
    );
  };

  return (
    <div className="ag-tplx">
      <div
        className="ag-tpl-tabs"
        role="tablist"
        aria-label="Coworker templates by team"
      >
        {AREAS.map((item, index) => (
          <button
            id={`${id}-tab-${index}`}
            key={item.name}
            type="button"
            role="tab"
            tabIndex={index === selectedArea ? 0 : -1}
            aria-selected={index === selectedArea}
            aria-controls={`${id}-panel`}
            onClick={() => setSelectedArea(index)}
            onKeyDown={(event) => selectFromKeyboard(event, index)}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div
        id={`${id}-panel`}
        className="ag-tpl-cards"
        role="tabpanel"
        aria-labelledby={`${id}-tab-${selectedArea}`}
      >
        {area.templates.map((template, index) => {
          const tint = pickTint(template.title, index, tintPicks);
          const kind = ["timeline", "checks", "chat", "bars"][
            index % 4
          ] as VisualKind;
          const style = {
            "--tpl-card-tint": `var(--tpl-tint-${tint})`,
            "--tpl-card-accent": `var(--tpl-acc-${tint})`,
            "--tpl-card-on-accent": `var(--tpl-onacc-${tint})`,
          } as CSSProperties;

          return (
            <a
              className="ag-tpl-card"
              href={CLOUD_URL}
              target="_blank"
              rel="noopener"
              key={template.title}
              style={style}
              aria-label={`${template.title}: ${template.description}`}
            >
              <div className="ag-tpl-vignette" aria-hidden="true">
                <TemplateVisual template={template} kind={kind} />
              </div>
              <div className="ag-tpl-card-copy">
                <h3>{template.title}</h3>
                <p>{template.description}</p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
