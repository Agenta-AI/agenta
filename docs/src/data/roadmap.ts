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
    id: "privacy-and-roles",
    title: "Private agents and chats",
    description:
      "New agents and chats start private. Share a chat with chosen people or the whole project, and project actions follow each member's role.",
    changelogPath: "/docs/changelog/private-agents-and-chats",
    shippedAt: "2026-10-26",
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
      "Paste a snippet to add an agent chat to your website or internal tool. Visitors don't need an Agenta account.",
    changelogPath: "/docs/guides/embed-an-agent",
    shippedAt: "2026-10-20",
    labels: [
      {
        name: "Channels",
        color: "2DD4BF",
      },
    ],
  },
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

export const inProgressFeatures: PlannedFeature[] = [
  {
    id: "builder-agent",
    title: "Builder agent",
    description:
      "One agent that creates and manages your other agents for you, and keeps a shared memory of what it learns about them.",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "inbox",
    title: "Inbox",
    description:
      "One place for updates about your agents, automations and workspace, so you see what happened and what needs you.",
    labels: [
      {
        name: "Notifications",
        color: "F472B6",
      },
    ],
  },
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
];

export const plannedFeatures: PlannedFeature[] = [
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
  {
    id: "mcp-registry",
    title: "MCP registry",
    description:
      "Pick from ready-made MCP servers and connect them to your agents by adding only your API key or token.",
    labels: [
      {
        name: "Tools & Triggers",
        color: "FFA500",
      },
    ],
  },
  {
    id: "cloud-browser",
    title: "Cloud browser for agents",
    description:
      "Each agent gets its own browser in the cloud, so it can visit websites and click, type and fill in forms for you.",
    labels: [
      {
        name: "Tools & Triggers",
        color: "FFA500",
      },
    ],
  },
];
