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
    id: "chat-session-view",
    title: "Chat Session View in Observability",
    description:
      "Display entire chat sessions in one consolidated view. Currently, each trace in a chat session appears in a separate tab. This feature will group traces by session ID and show the complete conversation in a single view.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/3052",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "trace-linking",
    title: "Navigation Links from Traces to App/Environment/Variant",
    description:
      "Add clickable links in the observability trace and drawer view to navigate to the application, variant, version, and environment used in each trace. Makes it easy to jump directly to the configuration that generated a specific trace.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2699",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
  {
    id: "prompt-folders",
    title: "Folders for Prompt Organization",
    description:
      "Create folders and subfolders to organize prompts in the playground. Move prompts between folders and search within specific folders to structure prompt libraries.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2859",
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
    id: "date-range-filtering",
    title: "Date Range Filtering in Metrics Dashboard",
    description:
      "We are adding the ability to filter traces by date range in the metrics dashboard.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2774",
    labels: [
      {
        name: "Observability",
        color: "DE74FF",
      },
    ],
  },
];

export const plannedFeatures: PlannedFeature[] = [
  {
    id: "ai-prompt-refinement",
    title: "AI-Powered Prompt Refinement in the Playground",
    description:
      "Analyze prompts and suggest improvements based on best practices. Identify issues, propose refined versions, and allow users to accept, modify, or reject suggestions.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2861",
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
    id: "navigation-in-the-playground",
    title: "Improving Navigation between Testsets in the Playground",
    description:
      "We are making it easy to use and navigate in the playground with large testsets  .",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2731",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "appending-single-test-cases",
    title: "Appending Single Testcases in the Playground",
    description:
      "Using testcases from different testsets is not possible right now in the Playground. We are adding the ability to append a single testcase to a testset.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2732",
    labels: [
      {
        name: "Playground",
        color: "BCFF78",
      },
    ],
  },
  {
    id: "test-set-view",
    title: "Improving Testset View",
    description:
      "We are reworking the testset view to make it easier to visualize and edit testsets.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2733",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
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
    id: "test-set-versioning",
    title: "Testset Versioning",
    description:
      "We are adding the ability to version testsets. This is useful for correctly comparing evaluation results.",
    githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2735",
    labels: [
      {
        name: "Evaluation",
        color: "86B7FF",
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
