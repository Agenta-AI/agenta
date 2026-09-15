import { useState } from "react";
import { ConfigAccordionSection } from "@agenta/ui/config-accordion";
import {
  Cpu,
  FileText,
  Wrench,
  GraduationCap,
  Robot,
  Lightning,
  ShieldCheck,
  CaretDoubleLeft,
  CaretRight,
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

export default function PlaygroundSettings({ agent, onHide }) {
  const [integration, setIntegration] = useState(null);
  const sections = [
    {
      title: "Model & harness",
      icon: Cpu,
      summary: "Claude Code",
      content: (
        <div className="ag-settings-fields">
          <label>
            Harness
            <input readOnly value="Claude Code" />
          </label>
          <label>
            Model
            <input readOnly value={agent.model} />
          </label>
        </div>
      ),
    },
    {
      title: "Instructions",
      icon: FileText,
      summary: "AGENTS.md",
      content: (
        <div className="ag-settings-fields">
          <textarea
            aria-label="Agent instructions"
            readOnly
            value={`# ${agent.title}\n\n${agent.desc}\n\nUse the connected apps and skills below. Cite sources, keep drafts ready for review, and ask before publishing or sending to customers.`}
          />
        </div>
      ),
    },
    {
      title: "Integrations",
      icon: Wrench,
      summary: `${agent.configIntegrations.length} connected`,
      open: true,
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
          <button
            className="ag-settings-item"
            key={name}
            onClick={() => setIntegration(name)}
          >
            <img src={LOGO[name]} alt="" />
            <span>
              <strong>{name}</strong>
              <small>{(actions[name] || []).length} actions enabled</small>
            </span>
            <CaretRight size={12} />
          </button>
        ))
      ),
    },
    {
      title: "Skills",
      icon: GraduationCap,
      summary: `${agent.configSkills.length} skills`,
      open: true,
      content: agent.configSkills.map((skill) => (
        <button
          className="ag-settings-item"
          key={skill.slug}
          onClick={skill.open}
        >
          <GraduationCap size={18} />
          <span>
            <strong>{skill.slug}</strong>
            <small>{skill.desc}</small>
          </span>
          <CaretRight size={12} />
        </button>
      )),
    },
    {
      title: "Subagents",
      icon: Robot,
      summary: `${agent.subagents.length} agents`,
      open: true,
      content: agent.subagents.map((subagent) => (
        <button
          className="ag-settings-item"
          key={subagent.title}
          onClick={subagent.open}
        >
          <Robot size={18} />
          <span>
            <strong>{subagent.title}</strong>
            <small>{subagent.desc}</small>
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
          Ask before publishing, sending messages, or changing connected
          records.
        </p>
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
            icon={<section.icon size={16} />}
            summary={section.summary}
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
        <span>{agent.autos.length}</span>
      </header>
      <div className="ag-settings-automations">
        {agent.autos.map((automation) => (
          <button
            className="ag-settings-item"
            key={automation.name}
            onClick={automation.open}
          >
            <Lightning size={18} />
            <span>
              <strong>{automation.name}</strong>
              <small>{automation.runsWhen}</small>
              <small>Runs {automation.agent}</small>
            </span>
            <CaretRight size={12} />
          </button>
        ))}
      </div>
      <header className="ag-settings-header">
        <strong>Files</strong>
        <span>{agent.files.length}</span>
      </header>
      <div className="ag-settings-files">
        {agent.files.map((file) => (
          <div className="ag-settings-item" key={file.name}>
            <FileText size={16} />
            <span>
              <strong>{file.name}</strong>
              <small>{file.when}</small>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
