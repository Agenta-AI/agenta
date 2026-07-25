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
    id: "playground-evaluation-workbench",
    title: "Evaluate While You Iterate in the Playground",
    description:
      "Attach evaluators to playground sessions and see scores inline as you iterate on prompts. Connect test sets to keep prompt iteration and data curation in one loop.",
    changelogPath: "/docs/changelog/playground-evaluation-workbench",
    shippedAt: "2026-06-09",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "annotation-queues",
    title: "Annotation Queues",
    description:
      "Build a review queue from traces or test set rows, attach a scoring schema, and route it to reviewers. Export finished queues as labeled test sets that feed straight into your evaluators.",
    changelogPath: "/docs/changelog/annotation-queues",
    shippedAt: "2026-05-18",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "deployment-webhooks",
    title: "Webhooks and GitHub Automations for Prompt Deployments",
    description:
      "Trigger CI and repository workflows when you deploy a prompt. Send deployment events to your own HTTPS endpoint or call GitHub directly with repository dispatch and workflow dispatch.",
    changelogPath: "/docs/changelog/deployment-webhooks-and-github-automations",
    shippedAt: "2026-03-11",
    labels: [
      {
        name: "Integration",
        color: "FFA500",
      },
    ],
  },
  {
    id: "tool-integrations",
    title: "Tool Integrations in the Playground",
    description:
      "Connect 150+ external tools (Gmail, Slack, Notion, Google Sheets, GitHub) to your prompts directly from the playground. Authenticate with OAuth, attach tool actions, and execute tool calls with one click.",
    changelogPath: "/docs/changelog/tool-integrations",
    shippedAt: "2026-02-27",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
      {
        name: "Integration",
        color: "FFA500",
      },
    ],
  },
  {
    id: "ai-prompt-refinement",
    title: "AI-Powered Prompt Refinement in the Playground",
    description:
      "Refine prompts with AI directly in the playground. Describe what you want to improve and get a refined version with an explanation of the changes.",
    changelogPath: "/docs/changelog/refine-ai",
    shippedAt: "2026-02-25",
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
    title: "Folders for Prompt Organization",
    description:
      "Create folders and subfolders to organize prompts. Drag prompts between folders and search across everything.",
    changelogPath: "/docs/changelog/prompt-folders",
    shippedAt: "2026-02-04",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "trace-linking",
    title: "Navigation Links from Traces to App/Environment/Variant",
    description:
      "Clickable links in observability traces to navigate to the application, variant, version, and environment used in each trace. Jump directly to the configuration that generated a specific trace.",
    changelogPath: "/docs/changelog/trace-navigation-links",
    shippedAt: "2026-01-28",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "date-range-filtering",
    title: "Date Range Filtering in Metrics Dashboard",
    description:
      "Filter traces by date range in the metrics dashboard. View metrics for the last 6 hours, 24 hours, 7 days, or 30 days.",
    changelogPath: "/docs/changelog/chat-sessions-observability",
    shippedAt: "2026-01-09",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "testset-versioning",
    title: "Test Set Versioning and New UI",
    description:
      "Track test set changes with versioning. Every edit creates a new version. Evaluations link to specific versions for reliable comparisons. Plus a rebuilt UI that scales to 100K+ rows with inline editing for chat messages and JSON.",
    changelogPath: "/docs/changelog/testset-versioning",
    shippedAt: "2026-01-20",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "chat-session-view",
    title: "Chat Sessions in Observability",
    description:
      "Track multi-turn conversations with session grouping. All traces with the same session ID are automatically grouped together, showing complete conversation flows with cost, latency, and token metrics per session.",
    changelogPath: "/docs/changelog/chat-sessions-observability",
    shippedAt: "2026-01-09",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "pdf-support-playground",
    title: "PDF Support in the Playground",
    description:
      "Attach PDF documents to chat messages in the playground. Upload files, provide URLs, or use file IDs from provider APIs. Works with OpenAI, Gemini, and Claude models. PDFs are supported in evaluations and observability traces.",
    changelogPath: "/docs/changelog/pdf-support-in-playground",
    shippedAt: "2025-12-17",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
      {
        name: "Evaluation",
        color: "86B7FF",
      },
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
    {
    id: "provider-built-in-tools",
    title: "Provider Built-in Tools in the Playground",
    description:
      "Use provider built-in tools like web search, code execution, and file search directly in the Playground. Supported providers include OpenAI, Anthropic, and Gemini. Tools are saved with prompts and automatically used via the LLM gateway.",
    changelogPath: "/docs/changelog/provider-built-in-tools",
    shippedAt: "2025-12-11",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "projects-within-organizations",
    title: "Projects within Organizations",
    description:
      "Create projects within organizations to divide work between different AI products. Each project scopes its prompts, traces, and evaluations independently.",
    changelogPath: "/docs/changelog/projects-within-organizations",
    shippedAt: "2025-12-04",
    labels: [
      {
        name: "Misc",
        color: "000000",
      },
    ],
  },
  {
    id: "jinja2-playground",
    title: "Jinja2 Template Support in the Playground",
    description:
      "Use Jinja2 templating in prompts to add conditional logic, filters, and template blocks. The template format is stored in the configuration schema, and the SDK handles rendering automatically.",
    changelogPath: "/docs/changelog/jinja2-template-support",
    shippedAt: "2025-11-17",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "evaluation-sdk",
    title: "Programmatic Evaluation through the SDK",
    description:
      "Run evaluations programmatically from code with full control over test data and evaluation logic. Evaluate agents built with any framework and view results in the Agenta dashboard.",
    changelogPath: "/docs/changelog/evaluation-sdk",
    shippedAt: "2025-11-11",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "online-evaluation",
    title: "Online Evaluation",
    description:
      "Automatically evaluate every request to your LLM application in production. Catch hallucinations and off-brand responses as they happen instead of discovering them through user complaints.",
    changelogPath: "/docs/changelog/online-evaluation",
    shippedAt: "2025-11-11",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "llm-judge-structured-output",
    title: "Customize LLM-as-a-Judge Output Schemas",
    description:
      "Configure LLM-as-a-Judge evaluators with custom output schemas. Use binary, multiclass, or custom JSON formats. Enable reasoning for better evaluation quality.",
    changelogPath: "/docs/changelog/customize-llm-as-a-judge-output-schemas",
    shippedAt: "2025-11-10",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "structured-output-playground",
    title: "Structured Output Support in the Playground",
    description:
      "Define and validate structured output formats in the playground. Save structured output schemas as part of your prompt configuration.",
    changelogPath: "/docs/changelog/structured-output-support-in-the-playground",
    shippedAt: "2025-04-15",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "vertex-ai-provider-support",
    title: "Vertex AI Provider Support",
    description:
      "Use Google Cloud's Vertex AI models including Gemini and partner models in the playground, Model Hub, and through Gateway endpoints.",
    changelogPath: "/docs/changelog/vertex-ai-provider-support",
    shippedAt: "2025-10-24",
    labels: [
      {
        name: "Integration",
        color: "FFA500",
      },
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "filtering-by-annotation",
    title: "Filtering Traces by Annotation",
    description:
      "Filter and search for traces based on their annotations. Find traces with low scores or feedback quickly using the rebuilt filtering system.",
    changelogPath: "/docs/changelog/filtering-traces-by-annotation",
    shippedAt: "2025-10-14",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "evaluation-results-dashboard",
    title: "New Evaluation Results Dashboard",
    description:
      "Completely redesigned evaluation results dashboard with performance plots, side-by-side comparison, improved testcases view, focused detail view, configuration visibility, and run naming.",
    changelogPath: "/docs/changelog/new-evaluation-results-dashboard",
    shippedAt: "2025-09-26",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },
  {
    id: "deep-url-support",
    title: "Deep URL Support for Sharable Links",
    description:
      "URLs now include workspace context, making them shareable between team members. Fixed workspace bugs with page refresh and workspace selection.",
    changelogPath: "/docs/changelog/deep-url-support-for-sharable-links",
    shippedAt: "2025-09-24",
    labels: [
      {
        name: "Misc",
        color: "000000",
      },
    ],
  },
  {
    id: "speed-improvements-playground",
    title: "Speed Improvements in the Playground",
    description:
      "We improved the speed of the playground (creation of prompts, navigation, etc.) especially with hundreds of revisions.",
    changelogPath: "/docs/changelog/speed-improvements-in-the-playground",
    shippedAt: "2025-09-19",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "markdown-support",
    title: "Markdown support ",
    description:
      "You can view prompt and messages in markdown both in the playground and in the observability drawer.",
    changelogPath: "/docs/changelog/major-playground-improvements-and-enhancements",
    shippedAt: "2025-08-07",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "images-in-playground",
    title: "Image Support in playground",
    description:
      "You can now upload images to the playground and use them in your prompts.",
    changelogPath: "/docs/changelog/support-for-images-in-playground",
    shippedAt: "2025-07-29",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "llamaindex-integration",
    title: "LLamaIndex Integration",
    description: "You can trace your calls from LlamaIndex in one line.",
    changelogPath: "/docs/changelog/llamaindex-integration",
    shippedAt: "2025-06-17",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "annotate-llm-response",
    title: "Endpoint to Capture User Feedback for Traces",
    description:
      "You can now use the annotation API to add annotations (e.g. scores, feedback) to LLM responses traced in Agenta.",
    changelogPath: "/docs/changelog/annotate-your-llm-response-preview",
    shippedAt: "2025-05-15",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "tool-support-playground",
    title: "Tool Support in the Playground",
    description:
      "You can now define and test tools in the playground. You can save tool definitions as part of your prompts.",
    changelogPath: "/docs/changelog/tool-support-in-the-playground",
    shippedAt: "2025-05-10",
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
