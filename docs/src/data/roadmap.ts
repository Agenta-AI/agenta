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
    id: "navigation-in-the-playground",
    title: "Improving Navigation between Testsets in the Playground",
    description:
      "We are making it easy to use and navigate in the playground with large testsets.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2731",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "prompt-snippets",
    title: "Prompt Snippets",
    description:
      "Create reusable prompt snippets that can be referenced across multiple prompts. Reference specific versions or always use the latest version to maintain consistency across prompt variants.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2858",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "open-spans-playground",
    title: "Open Observability Spans Directly in the Playground",
    description:
      "Add a button in observability to open any chat span directly in the playground. Creates a stateless playground session pre-filled with the exact prompt, configuration, and inputs for immediate iteration.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2862",
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
    id: "evaluators-in-playground",
    title: "Running Evaluators in the Playground",
    description:
      "Run evaluators directly in the playground to get immediate quality feedback on prompt changes. Evaluate outputs inline as you iterate on prompts. Scores, pass/fail results, and evaluator reasoning appear right next to the LLM response.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/3702",
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
    id: "agents-from-ui",
    title: "Creating Agents from the UI",
    description:
      "Build and configure AI agents directly from the Agenta UI. Define agent workflows, select tools, and set up orchestration logic without writing code. Test and iterate on agent behavior in the playground, then deploy to production with versioning and observability built in.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/3705",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "deployment-webhooks",
    title: "Webhooks for Deployment Linked to CI",
    description:
      "Trigger CI/CD pipelines automatically when you deploy a prompt version. Connect Agenta deployments to your existing CI workflows so that deploying a new version kicks off automated tests, approval gates, or release processes.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/3706",
    labels: [
      {
        name: "Integration",
        color: "FFA500",
      },
    ],
  },
];

export const plannedFeatures: PlannedFeature[] = [
  {
    id: "trace-usage-limits",
    title: "Usage Limits for Traces (Hard and Soft Caps)",
    description:
      "Set usage limits for traces at the project level. Configure a hard cap to stop accepting new traces once the limit is reached, or a soft cap to receive an alert while continuing to accept traces. Gives teams cost predictability and control in production.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/3784",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },

  {
    id: "prompt-caching-sdk",
    title: "Prompt Caching in the SDK",
    description: "We are adding the ability to cache prompts in the SDK.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2734",
    labels: [
      {
        name: "SDK",
        color: "DE74FF",
      },
    ],
  },

  {
    id: "tagging",
    title: "Tagging Traces, Testsets, Evaluations and Prompts",
    description:
      "We are adding the ability to tag traces, testsets, evaluations and prompts. This is useful for organizing and filtering your data.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2736",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
      },
    ],
  },

  // Example:
  // {
  //   id: "plg-cost-dashboard",
  //   title: "Cost Dashboard",
  //   description: "Track token usage and cost across environments and models.",
  //   githubUrl: "https://github.com/Agenta-AI/agenta/discussions/5678",
  // },
];
