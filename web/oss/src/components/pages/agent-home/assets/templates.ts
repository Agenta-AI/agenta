/**
 * Curated agent starter templates for the Home hero. Static mock registry (the backend can
 * host templates, but these aren't defined yet). Clicking a card opens the setup drawer, which
 * reads this registry; Create seeds an ephemeral agent draft from it.
 */

/** One tool the template's agent uses — shown (read-only) in the setup drawer's Tools preview. */
export interface TemplateTool {
    /** Human-readable action label, e.g. "Fetch conversation history". */
    name: string
    /** One-line description of what the tool does. */
    description: string
}

export interface RequiredIntegration {
    /** Composio integration slug (see PROVIDERS). */
    slug: string
    /** Per-template scope line shown in the setup drawer. */
    scope: string
    /** Tools the template calls on this integration — drive the Tools preview's provider group. */
    tools: TemplateTool[]
}

export interface AgentTemplate {
    key: string
    name: string
    /** Primary category for the Home filter chips. */
    category: string
    /** Monogram shown in the colored tile. */
    initials: string
    /** Tile accent color (data-driven → inline style). */
    color: string
    /** Short one-liner (card). */
    description: string
    /** Longer plain description (drawer overview). */
    overview: string
    /** AGENTS.md summary (drawer "Instructions"). Can be long. */
    instructions: string
    /** Tools summary (card meta + drawer Tools summary), e.g. "3 GitHub tools". */
    toolsSummary: string
    /** Trigger summary (card meta + drawer Trigger summary). */
    trigger: string
    /** One-line detail of when the trigger fires (drawer Trigger body). */
    triggerDescription: string
    /** Pre-filled playground message, auto-sent on entering a Ready playground. */
    seedMessage: string
    /** Default model (Agenta-managed · Pi). */
    model: string
    /** Integrations the template's tools require — drive the "Required to run" connect rows. */
    requiredIntegrations: RequiredIntegration[]
}

/** Provider slug → display label + brand logo URL (Composio logo CDN, the tool catalog's source). */
const composioLogo = (slug: string) => `https://logos.composio.dev/api/${slug}`

export const PROVIDERS: Record<string, {label: string; logo: string}> = {
    github: {label: "GitHub", logo: composioLogo("github")},
    slack: {label: "Slack", logo: composioLogo("slack")},
    notion: {label: "Notion", logo: composioLogo("notion")},
    linear: {label: "Linear", logo: composioLogo("linear")},
    sentry: {label: "Sentry", logo: composioLogo("sentry")},
    hubspot: {label: "HubSpot", logo: composioLogo("hubspot")},
}

/** Integration slugs a template touches (card provider marks). */
export const templateProviderSlugs = (template: AgentTemplate): string[] =>
    template.requiredIntegrations.map((integration) => integration.slug)

/** Total tool count across a template's integrations (drawer Tools count). */
export const templateToolCount = (template: AgentTemplate): number =>
    template.requiredIntegrations.reduce((n, integration) => n + integration.tools.length, 0)

/** Canonical chip order; only categories present in the templates render. */
export const TEMPLATE_CATEGORY_ORDER = ["Engineering", "Support", "Ops", "Docs"] as const

export const ALL_TEMPLATES_CATEGORY = "All"

/** Categories actually present in the template list, in canonical order. */
export const templateCategories = (): string[] =>
    TEMPLATE_CATEGORY_ORDER.filter((category) =>
        AGENT_TEMPLATES.some((template) => template.category === category),
    )

/** URL slug ⇄ category label (gallery deep-link `?category=engineering`). */
export const categorySlug = (category: string): string => category.toLowerCase()

export const categoryFromSlug = (slug: string | undefined): string =>
    templateCategories().find((category) => categorySlug(category) === slug?.toLowerCase()) ??
    ALL_TEMPLATES_CATEGORY

const DEFAULT_MODEL = "claude-sonnet-4-5"

export const AGENT_TEMPLATES: AgentTemplate[] = [
    {
        key: "support-triage",
        name: "Support triage",
        category: "Support",
        initials: "S",
        color: "#7c3aed",
        description: "Reads #support, tags urgency, routes to owners.",
        overview:
            "Watches your #support channel. Triages every new thread by urgency, routes it to the right owner, and checks with you before closing anything.",
        instructions:
            "Watch #support. Triage each new thread by urgency and route it to the right owner; ask before closing anything.",
        toolsSummary: "2 Slack tools",
        trigger: "New message in #support",
        triggerDescription: "Runs whenever a new message is posted in #support.",
        seedMessage: "Triage the newest #support thread and route it to the right owner.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "slack",
                scope: "Read channels, post & assign threads",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read recent messages in a channel to understand the thread.",
                    },
                    {
                        name: "Send message",
                        description: "Reply in-thread and route it to the right owner.",
                    },
                ],
            },
        ],
    },
    {
        key: "pr-reviewer",
        name: "PR reviewer",
        category: "Engineering",
        initials: "PR",
        color: "#1c2c3d",
        description: "Reviews PRs, comments inline, flags risky changes.",
        overview:
            "Reviews every opened pull request. Comments inline on risky changes, flags missing tests, and posts a plain-English summary for the author.",
        instructions:
            "Review each opened PR. Comment inline on risky changes, flag missing tests, summarize the diff.",
        toolsSummary: "3 GitHub tools",
        trigger: "Pull request opened",
        triggerDescription: "Runs when a pull request is opened.",
        seedMessage:
            "Review the latest open PR: comment inline on risky changes and post a summary for the author.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read PRs, post reviews & comments",
                tools: [
                    {
                        name: "Get pull request",
                        description: "Read a PR's diff, changed files, and metadata.",
                    },
                    {
                        name: "Create review comment",
                        description: "Comment inline on specific lines of the diff.",
                    },
                    {
                        name: "Create issue comment",
                        description: "Post the plain-English summary on the PR.",
                    },
                ],
            },
        ],
    },
    {
        key: "changelog-writer",
        name: "Changelog writer",
        category: "Engineering",
        initials: "CL",
        color: "#14b8a6",
        description: "Turns merged PRs into clean release notes.",
        overview:
            "Turns merged pull requests into clean release notes and posts them wherever your team reads changelogs.",
        instructions:
            "Turn merged pull requests into clean, human-readable release notes and publish them.",
        toolsSummary: "GitHub + Notion tools",
        trigger: "On release",
        triggerDescription: "Runs when a release is published.",
        seedMessage: "Draft release notes from the PRs merged since the last release.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read merged PRs",
                tools: [
                    {
                        name: "List pull requests",
                        description: "Fetch the PRs merged since the last release.",
                    },
                    {
                        name: "Get pull request",
                        description: "Read a PR's title, body, and labels.",
                    },
                ],
            },
            {
                slug: "notion",
                scope: "Read & write pages",
                tools: [
                    {
                        name: "Create page",
                        description: "Create a new release-notes page.",
                    },
                    {
                        name: "Append block children",
                        description: "Add formatted release-note entries to the page.",
                    },
                ],
            },
        ],
    },
    {
        key: "incident-responder",
        name: "Incident responder",
        category: "Ops",
        initials: "!",
        color: "#f59e0b",
        description: "Watches alerts, gathers context, pages on-call.",
        overview:
            "Watches your alerts. Gathers related context and logs, summarizes the likely cause, and pages the on-call engineer.",
        instructions:
            "On an alert, gather context and logs, summarize the likely cause, and page the on-call engineer.",
        toolsSummary: "Sentry + Slack tools",
        trigger: "On alert",
        triggerDescription: "Runs when a new alert fires.",
        seedMessage: "Summarize the latest alert and identify the likely cause.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "sentry",
                scope: "Read alerts & issues",
                tools: [
                    {
                        name: "List issues",
                        description: "Fetch recent alerts and their status.",
                    },
                    {
                        name: "Get issue",
                        description: "Read an issue's stack trace and recent events.",
                    },
                ],
            },
            {
                slug: "slack",
                scope: "Post & page on-call",
                tools: [
                    {
                        name: "Send message",
                        description: "Page the on-call engineer with a summary.",
                    },
                ],
            },
        ],
    },
    {
        key: "standup-summarizer",
        name: "Standup summarizer",
        category: "Ops",
        initials: "SU",
        color: "#3b82f6",
        description: "Posts a daily digest of channel activity.",
        overview:
            "Posts a daily digest of channel activity so your team starts the day with a clear standup summary.",
        instructions:
            "Each morning, summarize yesterday's channel activity into a short standup digest and post it.",
        toolsSummary: "2 Slack tools",
        trigger: "Daily at 09:00",
        triggerDescription: "Runs every day at 09:00.",
        seedMessage: "Summarize yesterday's activity into a standup digest.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "slack",
                scope: "Read channels, post digest",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read yesterday's messages across the tracked channels.",
                    },
                    {
                        name: "Send message",
                        description: "Post the standup digest.",
                    },
                ],
            },
        ],
    },
    {
        key: "docs-qa",
        name: "Docs Q&A",
        category: "Docs",
        initials: "Q",
        color: "#1c2c3d",
        description: "Answers questions from your docs workspace.",
        overview:
            "Answers questions from your docs workspace with concise, cited answers — in chat or on mention.",
        instructions:
            "Answer questions by searching the docs workspace; return a concise, cited answer.",
        toolsSummary: "Notion + Slack tools",
        trigger: "On mention",
        triggerDescription: "Runs when the agent is @-mentioned.",
        seedMessage: "Answer: how do I get started? — using our docs.",
        model: DEFAULT_MODEL,
        requiredIntegrations: [
            {
                slug: "notion",
                scope: "Read pages",
                tools: [
                    {
                        name: "Search",
                        description: "Find pages relevant to the question.",
                    },
                    {
                        name: "Get page content",
                        description: "Read a page's blocks to draft a cited answer.",
                    },
                ],
            },
            {
                slug: "slack",
                scope: "Reply on mention",
                tools: [
                    {
                        name: "Send message",
                        description: "Reply to the mention with the answer.",
                    },
                ],
            },
        ],
    },
]
