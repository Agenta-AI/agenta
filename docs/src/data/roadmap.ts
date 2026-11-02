export type Label = {
  name: string;
  color?: string; // hex without '#'
};

export type ShippedFeature = {
  id: string;
  title: string;
  description?: string;
  changelogPath: string; // e.g. "/changelog/2025-06-18-feature-name"
  shippedAt: string; // ISO date string or any displayable date
  labels?: Label[];
};

export type PlannedFeature = {
  id: string;
  title: string;
  description: string;
  githubUrl?: string; // issue or discussion URL
  labels?: Label[];
};

// Recent product highlights, newest first. Match dates and links to the changelog.
export const shippedFeatures: ShippedFeature[] = [
  {
    id: "agent-setup",
    title: "Set up agents through chat",
    description:
      "Ask your agent to configure integrations, skills and automations with Create with AI.",
    changelogPath: "/docs/changelog/let-the-agent-set-itself-up",
    shippedAt: "2026-09-30",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "agent-templates",
    title: "Agent templates and marketplace",
    description:
      "Start from an agent template, or save your own agent with its skills and files as a template to share.",
    changelogPath: "/docs/changelog/agent-templates-and-marketplace",
    shippedAt: "2026-09-28",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "channel-actions",
    title: "Agents can work in your channels",
    description:
      "Agents can post, read and search messages in connected Slack and Telegram channels, including from scheduled runs.",
    changelogPath: "/docs/changelog/agents-work-with-your-channels",
    shippedAt: "2026-09-26",
    labels: [
      {
        name: "Channels",
        color: "2DD4BF",
      },
    ],
  },
  {
    id: "clearer-chat",
    title: "A clearer agent chat",
    description:
      "Follow thinking, tool calls and generated files in one activity timeline. Answer agent questions directly in chat.",
    changelogPath: "/docs/changelog/clearer-agent-chat",
    shippedAt: "2026-09-24",
    labels: [
      {
        name: "Chat",
        color: "5CC8FF",
      },
    ],
  },
  {
    id: "file-editor",
    title: "Edit files with your agent",
    description:
      "Edit documents and code in the Files pane with autosave while your agent works on the same files.",
    changelogPath: "/docs/changelog/edit-files-with-your-agent",
    shippedAt: "2026-09-17",
    labels: [
      {
        name: "Files",
        color: "5CC8FF",
      },
    ],
  },
  {
    id: "chatgpt-subscription",
    title: "Connect your ChatGPT subscription",
    description:
      "Sign in with your ChatGPT account and use your subscription to run agents in Agenta.",
    changelogPath: "/docs/changelog/chatgpt-subscription-for-agents",
    shippedAt: "2026-09-11",
    labels: [
      {
        name: "Models",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "skill-registry",
    title: "Reusable skills",
    description:
      "Publish a skill once and install it in multiple agents. Pin a version or follow the latest version.",
    changelogPath: "/docs/changelog/reuse-skills-across-agents",
    shippedAt: "2026-09-10",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
];

export const inProgressFeatures: PlannedFeature[] = [];

export const plannedFeatures: PlannedFeature[] = [
  {
    id: "agent-communication",
    title: "Agent communication and subagents",
    description:
      "Improve how agents delegate work to subagents and exchange information while working on a task.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/6053",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "privacy-and-roles",
    title: "Session and agent privacy",
    description:
      "Improve control over who can access sessions and agents, with roles that define what each person can see and do.",
    labels: [
      {
        name: "Privacy & Access",
        color: "000000",
      },
    ],
  },
  {
    id: "embedded-agents",
    title: "Embed agents in your website",
    description:
      "Add an agent to your website or app, including through an iframe, so people can use it there.",
    labels: [
      {
        name: "Channels",
        color: "2DD4BF",
      },
    ],
  },
  {
    id: "custom-triggers",
    title: "Custom triggers",
    description:
      "Start agents from custom event sources, including direct webhooks and user-defined events beyond the Composio catalog.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5514",
    labels: [
      {
        name: "Tools & Triggers",
        color: "FFA500",
      },
    ],
  },
];
