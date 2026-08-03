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
  githubUrl: string; // issue or discussion URL
  labels?: Label[];
};

export const shippedFeatures: ShippedFeature[] = [
  // Playground: BCFF78
  // Observability: DE74FF
  // Evaluation: 86B7FF
  // Integration: FFA500
  // Security: 000000
  // Agent Builder: BCFF78
  // Reliability: FF6B6B
  // Approvals: FFC53D
  // Multimodality: 5CC8FF
  // Channels: 2DD4BF
  // Mobile: F472B6
  {
    id: "agents-from-ui",
    title: "Creating Agents from the UI",
    description:
      "Build and configure AI agents directly from the Agenta UI. Define agent workflows, select tools, and set up orchestration logic without writing code. Test and iterate on agent behavior in the playground, then deploy to production with versioning and observability built in.",
    changelogPath: "/docs/changelog/agenta-is-now-a-workspace-for-building-agents",
    shippedAt: "2026-07-21",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "enterprise-compliance",
    title: "Enterprise Compliance Features",
    description:
      "Multi-organization support, SSO with any OIDC provider, domain verification with auto-join, and a US region.",
    changelogPath: "/docs/changelog/enterprise-compliance-features",
    shippedAt: "2026-02-17",
    labels: [
      {
        name: "Security",
        color: "000000",
      },
    ],
  },
  {
    id: "prompt-folders",
    title: "Folders for Agent Organization",
    description:
      "Create folders and subfolders to organize your agents. Drag them between folders and search across everything.",
    changelogPath: "/docs/changelog/prompt-folders",
    shippedAt: "2026-02-04",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
];
export const inProgressFeatures: PlannedFeature[] = [
  {
    id: "durable-sessions",
    title: "Durable Agent Sessions",
    description:
      "Keep the full conversation when the process running an agent restarts. The runner rebuilds session history from stored records on a cold start, so an agent resumes exactly where it left off instead of losing or replaying earlier turns.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5443",
    labels: [
      {
        name: "Reliability",
        color: "FF6B6B",
      },
    ],
  },
  {
    id: "voice-and-attachments",
    title: "Voice and Attachments",
    description:
      "Talk to an agent with voice input, and attach files or drive uploads to a message. Adds input beyond text so agents can work with what the user says and shares, not just typed prompts.",
    githubUrl: "https://github.com/Agenta-AI/agenta/pull/5439",
    labels: [
      {
        name: "Multimodality",
        color: "5CC8FF",
      },
    ],
  },
  {
    id: "batch-tool-approvals",
    title: "Batch Tool Approvals",
    description:
      "Approve or deny several tool calls together in one step, including a deny-all option, instead of handling one approval card at a time. Makes the human-in-the-loop approval flow faster when an agent requests many tools at once.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5391",
    labels: [
      {
        name: "Approvals",
        color: "FFC53D",
      },
    ],
  },
  {
    id: "build-kit-context",
    title: "A Build Kit That Manages Its Own Context",
    description:
      "Give agents with many tools and large tool results a reliable context. Tools are revealed to the model in stages as the toolset grows, and oversized tool outputs are capped so a single large result does not break a long conversation.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5341",
    labels: [
      {
        name: "Build Kit",
        color: "FFA500",
      },
    ],
  },
];

export const plannedFeatures: PlannedFeature[] = [
  {
    id: "channels",
    title: "Channels: Slack, Telegram, and More",
    description:
      "Connect an agent to the messaging surfaces people already use. A channel routes an incoming Slack or Telegram message to an agent session and delivers the agent's reply back to that same surface.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5510",
    labels: [
      {
        name: "Channels",
        color: "2DD4BF",
      },
    ],
  },
  {
    id: "mobile",
    title: "Agenta on Mobile",
    description:
      "Use the core agent experience from a phone. Chat with an agent, approve or deny tool calls, and browse past runs on a small screen.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5511",
    labels: [
      {
        name: "Mobile",
        color: "F472B6",
      },
    ],
  },
  {
    id: "skill-registry",
    title: "Skill Registry",
    description:
      "Publish a skill once, then browse and install it into any agent, with versioning. Teams reuse skills instead of defining the same one by hand on every agent.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5512",
    labels: [
      {
        name: "Agent Builder",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "mcp-gateway",
    title: "MCP Gateway",
    description:
      "Reach MCP tools through one managed entry point. MCP servers are registered centrally, and an agent's tool calls route through the gateway with shared authentication and access policy, instead of configuring each server on every agent.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5513",
    labels: [
      {
        name: "Tools & Triggers",
        color: "FFA500",
      },
    ],
  },
  {
    id: "custom-triggers",
    title: "Custom Triggers",
    description:
      "Start an agent from sources beyond the Composio catalog, including direct webhooks and AI-configured or user-defined events. Triggers today are limited to Composio events; this opens them to custom sources.",
    githubUrl: "https://github.com/Agenta-AI/agenta/issues/5514",
    labels: [
      {
        name: "Tools & Triggers",
        color: "FFA500",
      },
    ],
  },
];
