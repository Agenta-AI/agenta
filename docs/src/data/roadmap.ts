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
        id: "vertex-ai-provider-support",
        title: "Vertex AI Provider Support",
        description: "Use Google Cloud's Vertex AI models including Gemini and partner models in the playground, Model Hub, and through Gateway endpoints.",
        changelogPath: "/changelog/vertex-ai-provider-support",
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
        description: "Filter and search for traces based on their annotations. Find traces with low scores or feedback quickly using the rebuilt filtering system.",
        changelogPath: "/changelog/filtering-traces-by-annotation",
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
        description: "Completely redesigned evaluation results dashboard with performance plots, side-by-side comparison, improved test cases view, focused detail view, configuration visibility, and run naming.",
        changelogPath: "/changelog/new-evaluation-results-dashboard",
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
        description: "URLs now include workspace context, making them shareable between team members. Fixed workspace bugs with page refresh and workspace selection.",
        changelogPath: "/changelog/deep-url-support-for-sharable-links",
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
        description: "We improved the speed of the playground (creation of prompts, navigation, etc.) especially with hundreds of revisions.",
        changelogPath: "/changelog/speed-improvements-in-the-playground",
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
        description: "You can view prompt and messages in markdown both in the playground and in the observability drawer.",
        changelogPath: "/changelog/major-playground-improvements-and-enhancements",
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
        description: "You can now upload images to the playground and use them in your prompts.",
        changelogPath: "/changelog/support-for-images-in-playground",
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
        changelogPath: "/changelog/llamaindex-integration",
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
        description: "You can now use the annotation API to add annotations (e.g. scores, feedback) to LLM responses traced in Agenta.",
        changelogPath: "/changelog/annotate-your-llm-response-preview",
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
        description: "You can now define and test tools in the playground. You can save tool definitions as part of your prompts.",
        changelogPath: "/changelog/tool-support-in-the-playground",
        shippedAt: "2025-05-10",
        labels: [
            {
                name: "Playground",
                color: "BCFF78",
            },
        ],
    },
    {
        id: "structured-output-playground",
        title: "Structured Output Support in the Playground",
        description: "We support now structured output in the playground. You can now define and validate structured output formats and save them as part of your prompt.",
        changelogPath: "/changelog/structured-output-support-in-the-playground",
        shippedAt: "2025-04-15",
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
        id: "llm-judge-structured-output",
        title: "Structured Output and Multiple Outputs in LLM-as-a-Judge Evaluators",
        description: "Use structured output formats and generate multiple output fields (explanation, confidence, suggestions, issue categories) in LLM-as-a-judge evaluators.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2855",
        labels: [
            {
                name: "Evaluation",
                color: "86B7FF",
            },
        ],
    },
    {
        id: "jinja2-playground",
        title: "Jinja2 Template Support in the Playground",
        description: "Add Jinja2 template support to enable conditional logic, filters, and template blocks in prompts. The prompt type will be stored in the schema, and the SDK will handle rendering.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2856",
        labels: [
            {
                name: "Playground",
                color: "BCFF78",
            },
        ],
    },
    {
        id: "pdf-support-playground",
        title: "PDF Support in the Playground",
        description: "Add PDF support for models that support it (OpenAI, Gemini, etc.) through base64 encoding, URLs, or file IDs. Support extends to human evaluation for reviewing model responses on PDF inputs.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2857",
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
        description: "Create reusable prompt snippets that can be referenced across multiple prompts. Reference specific versions or always use the latest version to maintain consistency across prompt variants.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2858",
        labels: [
            {
                name: "Playground",
                color: "BCFF78",
            },
        ],
    },
    {
        id: "online-evaluation",
        title: "Online Evaluation",
        description: "Adding the ability to configure evaluators (llm-as-a-judge or custom) and run them automatically on new traces.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2721",
        labels: [
            {
                name: "Evaluation",
                color: "86B7FF",
            },
        ],
    },
    {
        id: "evaluation-sdk",
        title: "Programmatic Evaluation through the SDK",
        description: "Until now evaluations were only available as managed by Agenta. We are now adding the ability to run evaluations programmatically through the SDK.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2725",
        labels: [
            {
                name: "Evaluation",
                color: "86B7FF",
            },
        ],
    },
    {
        id: "date-range-filtering",
        title: "Date Range Filtering in Metrics Dashboard",
        description: "We are adding the ability to filter traces by date range in the metrics dashboard.",
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
        id: "prompt-folders",
        title: "Folders for Prompt Organization",
        description: "Create folders and subfolders to organize prompts in the playground. Move prompts between folders and search within specific folders to structure prompt libraries.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2859",
        labels: [
            {
                name: "Playground",
                color: "BCFF78",
            },
        ],
    },
    {
        id: "projects-workspaces",
        title: "Projects and Workspaces",
        description: "Improve organization structure by adding projects and workspaces. Create projects for different products, set up workspaces for different environments or teams, and scope resources to specific workspaces.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2860",
        labels: [
            {
                name: "Misc",
                color: "000000",
            },
        ],
    },
    {
        id: "ai-prompt-refinement",
        title: "AI-Powered Prompt Refinement in the Playground",
        description: "Analyze prompts and suggest improvements based on best practices. Identify issues, propose refined versions, and allow users to accept, modify, or reject suggestions.",
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
        description: "Add a button in observability to open any chat span directly in the playground. Creates a stateless playground session pre-filled with the exact prompt, configuration, and inputs for immediate iteration.",
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
        title: "Improving Navigation between Test Sets in the Playground",
        description: "We are making it easy to use and navigate in the playground with large test sets  .",
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
        title: "Appending Single Test Cases in the Playground",
        description: "Using test cases from different test sets is not possible right now in the Playground. We are adding the ability to append a single test case to a test set.",
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
        title: "Improving Test Set View",
        description: "We are reworking the test set view to make it easier to visualize and edit test sets.",
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
        title: "Test Set Versioning",
        description: "We are adding the ability to version test sets. This is useful for correctly comparing evaluation results.",
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
        title: "Tagging Traces, Test Sets, Evaluations and Prompts",
        description: "We are adding the ability to tag traces, test sets, evaluations and prompts. This is useful for organizing and filtering your data.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2736",
        labels: [
            {
                name: "Evaluation",
                color: "86B7FF",
            },
        ],
    },
    {
        id: "tools-playground",
        title: "Support for built-in LLM Tools (e.g. web search) in the Playground",
        description: "We are adding the ability to use built-in LLM tools (e.g. web search) in the playground.",
        githubUrl: "https://github.com/Agenta-AI/agenta/discussions/2577",
        labels: [
            {
                name: "Playground",
                color: "BCFF78",
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


