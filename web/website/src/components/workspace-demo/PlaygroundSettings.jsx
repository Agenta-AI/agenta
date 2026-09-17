import { useState } from "react";
import { ConfigAccordionSection } from "@agenta/ui/config-accordion";
import {
  Cpu,
  FileText,
  PuzzlePiece,
  GraduationCap,
  Robot,
  Plugs,
  Clock,
  ShieldCheck,
  SlidersHorizontal,
  CaretDoubleLeft,
  CaretDown,
  CaretRight,
  DotsThreeVertical,
  Plus,
  ArrowLeft,
} from "@phosphor-icons/react";
import { LOGO } from "./fixtures.js";

const actions = {
  Notion: [
    "Read content briefs",
    "Create research pages",
    "Update draft status",
  ],
  GitHub: [
    "Read repository files",
    "Review pull requests",
    "Open draft pull requests",
  ],
  Slack: ["Read team discussions", "Post summaries for review"],
  HubSpot: [
    "Read companies and contacts",
    "Update lead qualification",
    "Create follow-up tasks",
  ],
  Zendesk: [
    "Read support tickets",
    "Add internal notes",
    "Update ticket labels",
  ],
  Linear: ["Read issues", "Create bug reports", "Update triage status"],
  Drive: ["Read shared documents", "Create working drafts"],
  Discord: ["Read community threads", "Prepare community replies"],
};

// The product's collapsed-section summary: "3 integrations", "1 skill", "None".
const countSummary = (n, noun) =>
  n > 0 ? `${n} ${noun}${n === 1 ? "" : "s"}` : "None";

// Row avatar colors from the product item descriptors.
const AVATAR = {
  instructions: "#0f766e",
  subagent: "#7c3aed",
  skill: "#6b7280",
};

// Inert header add affordance, like the product section headers.
const addButton = (label) => (
  <span className="ag-settings-add" aria-hidden="true" title={label}>
    <Plus size={14} />
  </span>
);

const FILE_SIZES = ["3.0 KB", "1.2 KB", "4.7 KB", "0.8 KB", "12 KB"];

export default function PlaygroundSettings({ agent, onHide }) {
  const [integration, setIntegration] = useState(null);
  const instructionsOpen = false;
  const agentsMd = `# ${agent.title}\n\n${agent.desc}\n\nUse the connected apps and skills below. Cite sources, keep drafts ready for review, and ask before publishing or sending to customers.`;
  const wordCount = agentsMd.trim().split(/\s+/).filter(Boolean).length;
  const mdPreview = agentsMd.replace(/[#\n]+/g, " ").trim();
  // Titles, icons, order, summaries, and row presentation mirror the product
  // config panel (AgentTemplateControl): Model, Instructions, Integrations,
  // Subagents, MCP servers, Skills, Permissions, Advanced.
  const sections = [
    {
      title: "Model",
      icon: Cpu,
      summary: `Claude Code · ${agent.model}`,
      open: true,
      content: (
        <div className="ag-settings-select" role="presentation">
          <span>{agent.model}</span>
          <CaretDown size={12} />
        </div>
      ),
    },
    {
      title: "Instructions",
      icon: FileText,
      summary: "1 file",
      open: true,
      content: (
        <>
          <button
            className="ag-settings-item"
            aria-disabled="true"
            aria-expanded={instructionsOpen}
          >
            <span
              className="ag-settings-avatar"
              style={{ background: AVATAR.instructions }}
            >
              <FileText size={14} />
            </span>
            <span>
              <span className="ag-settings-name-row">
                <strong className="ag-settings-mono">AGENTS.md</strong>
                <small>{wordCount} words</small>
              </span>
              <small className="ag-settings-preview">{mdPreview}</small>
            </span>
            <CaretRight size={12} />
          </button>
          {instructionsOpen && (
            <textarea
              aria-label="Agent instructions"
              readOnly
              value={agentsMd}
            />
          )}
        </>
      ),
    },
    {
      title: "Integrations",
      icon: PuzzlePiece,
      summary: countSummary(agent.configIntegrations.length, "integration"),
      open: true,
      extra: addButton("Add integration"),
      content: integration ? (
        <div className="ag-settings-integration">
          <button
            className="ag-settings-back"
            onClick={() => setIntegration(null)}
          >
            <ArrowLeft size={14} />
            All integrations
          </button>
          <h4>{integration}</h4>
          <p>Available actions</p>
          <ul>
            {(
              actions[integration] || [
                "Read workspace context",
                "Prepare updates for review",
              ]
            ).map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : (
        agent.configIntegrations.map((name) => (
          <button className="ag-settings-item" key={name} aria-disabled="true">
            <img src={LOGO[name]} alt="" />
            <span>
              <strong>{name}</strong>
            </span>
            <CaretRight size={12} />
          </button>
        ))
      ),
    },
    {
      title: "Subagents",
      icon: Robot,
      summary: countSummary(agent.subagents.length, "subagent"),
      open: agent.subagents.length > 0,
      extra: addButton("Add subagent"),
      content: agent.subagents.map((subagent) => (
        <button
          className="ag-settings-item"
          key={subagent.title}
          aria-disabled="true"
        >
          <span
            className="ag-settings-avatar"
            style={{ background: AVATAR.subagent }}
          >
            <Robot size={14} />
          </span>
          <span>
            <strong>{subagent.title}</strong>
            <small className="ag-settings-preview">{subagent.desc}</small>
          </span>
          <CaretRight size={12} />
        </button>
      )),
    },
    {
      title: "MCP servers",
      icon: Plugs,
      summary: "None",
      extra: addButton("Add MCP server"),
      content: <p className="ag-settings-note">No servers connected.</p>,
    },
    {
      title: "Skills",
      icon: GraduationCap,
      summary: countSummary(agent.configSkills.length, "skill"),
      open: true,
      extra: addButton("Add skill"),
      content: agent.configSkills.map((skill) => (
        <button
          className="ag-settings-item"
          key={skill.slug}
          aria-disabled="true"
        >
          <span
            className="ag-settings-avatar"
            style={{ background: AVATAR.skill }}
          >
            <GraduationCap size={14} />
          </span>
          <span>
            <strong>{skill.slug}</strong>
            <small className="ag-settings-preview">{skill.desc}</small>
          </span>
          <CaretRight size={12} />
        </button>
      )),
    },
    {
      title: "Permissions",
      icon: ShieldCheck,
      summary: "Ask",
      content: (
        <p className="ag-settings-note">
          Ask — a human approves every tool call. Publishing, sending messages,
          and changing connected records always wait for review.
        </p>
      ),
    },
    {
      title: "Advanced",
      icon: SlidersHorizontal,
      summary: "Sandbox: local",
      content: (
        <div className="ag-settings-fields">
          <label>
            Sandbox
            <input readOnly value="local" />
          </label>
          <label>
            Network
            <input readOnly value="on" />
          </label>
        </div>
      ),
    },
  ];
  return (
    <aside
      className="ag-app-config ag-demo-config"
      aria-label="Agent configuration"
    >
      <header className="ag-settings-header">
        <strong>Configuration</strong>
        <button aria-label="Hide configuration" onClick={onHide}>
          <CaretDoubleLeft size={16} />
        </button>
      </header>
      <div className="ag-settings-sections">
        {sections.map((section) => (
          <ConfigAccordionSection
            key={section.title}
            title={section.title}
            preserveTitle
            icon={<section.icon size={16} />}
            summary={section.summary}
            extra={section.extra}
            open={
              ["Permissions", "Advanced"].includes(section.title)
                ? false
                : undefined
            }
            onOpenChange={() => {}}
            defaultOpen={section.open || false}
            headerBand="-mx-4 px-4"
            bodyClassName="ag-settings-body"
          >
            {section.content}
          </ConfigAccordionSection>
        ))}
      </div>
      <header className="ag-settings-header">
        <strong>Automations</strong>
        <span className="ag-settings-header-end">
          {countSummary(agent.autos.length, "automation")}
          {addButton("Add automation")}
        </span>
      </header>
      <div className="ag-settings-automations">
        {agent.autos.map((automation) => (
          <button
            className="ag-settings-item"
            key={automation.name}
            aria-disabled="true"
          >
            <span className="ag-settings-avatar ag-settings-avatar--muted">
              <Clock size={15} />
              <i className="ag-settings-dot" aria-hidden="true" />
            </span>
            <span>
              <strong>{automation.name}</strong>
              <small className="ag-settings-preview">
                {automation.runsWhen}
              </small>
            </span>
            <DotsThreeVertical size={14} />
          </button>
        ))}
      </div>
      <header className="ag-settings-header">
        <strong>Files</strong>
        <span>{countSummary(agent.files.length, "file")}</span>
      </header>
      <div className="ag-settings-files">
        {agent.files.map((file, index) => (
          <div className="ag-settings-item" key={file.name}>
            <FileText size={16} />
            <span className="ag-settings-name-row">
              <strong className="ag-settings-mono">{file.name}</strong>
              <em className="ag-settings-tag">Agent</em>
            </span>
            <small className="ag-settings-item-meta">
              {FILE_SIZES[index % FILE_SIZES.length]} · {file.when}
            </small>
          </div>
        ))}
      </div>
    </aside>
  );
}
