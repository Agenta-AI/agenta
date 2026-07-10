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
    /**
     * Optional initial instruction for the agent-BUILDER flow (`NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`):
     * the message seeded into a blank agent's playground chat so the builder configures it. Falls back
     * to a derived phrasing (see {@link templateBuilderMessage}) when omitted.
     */
    builderMessage?: string
    /** Default model (Agenta-managed · Pi). */
    model: string
    /**
     * Every integration the use case might touch, shown as card/chip logos. Display-only — it
     * never gates Create. `requiredIntegrations` is the separate, functional connect/tools list.
     */
    logoSlugs?: string[]
    /**
     * Exactly the connections the template's playbook hard-requires — drive the "Required to run"
     * connect rows. Alternatives (the "X or Y" of a pick-one source/destination) and optional
     * extensions are display-only `logoSlugs`, never listed here; only the primary/SOLID one of an
     * alternative group is required. Mirrors each playbook's Connections section in
     * `sdks/python/agenta/sdk/agents/adapters/agent_templates/*.py`.
     */
    requiredIntegrations: RequiredIntegration[]
}

/** Provider slug → display label + brand logo URL (Composio logo CDN, the tool catalog's source). */
const composioLogo = (slug: string) => `https://logos.composio.dev/api/${slug}`

export const PROVIDERS: Record<string, {label: string; logo: string}> = {
    github: {label: "GitHub", logo: composioLogo("github")},
    gitlab: {label: "GitLab", logo: composioLogo("gitlab")},
    slack: {label: "Slack", logo: composioLogo("slack")},
    discord: {label: "Discord", logo: composioLogo("discord")},
    notion: {label: "Notion", logo: composioLogo("notion")},
    confluence: {label: "Confluence", logo: composioLogo("confluence")},
    googledrive: {label: "Google Drive", logo: composioLogo("googledrive")},
    googlecalendar: {label: "Google Calendar", logo: composioLogo("googlecalendar")},
    gmail: {label: "Gmail", logo: composioLogo("gmail")},
    telegram: {label: "Telegram", logo: composioLogo("telegram")},
    linear: {label: "Linear", logo: composioLogo("linear")},
    jira: {label: "Jira", logo: composioLogo("jira")},
    sentry: {label: "Sentry", logo: composioLogo("sentry")},
    datadog: {label: "Datadog", logo: composioLogo("datadog")},
    newrelic: {label: "New Relic", logo: composioLogo("new_relic")},
    pagerduty: {label: "PagerDuty", logo: composioLogo("pagerduty")},
    hubspot: {label: "HubSpot", logo: composioLogo("hubspot")},
    salesforce: {label: "Salesforce", logo: composioLogo("salesforce")},
    attio: {label: "Attio", logo: composioLogo("attio")},
    intercom: {label: "Intercom", logo: composioLogo("intercom")},
    zendesk: {label: "Zendesk", logo: composioLogo("zendesk")},
    posthog: {label: "PostHog", logo: composioLogo("posthog")},
}

/** Integration slugs a template touches (card provider marks). Prefers display logos; falls
 * back to the required-to-run slugs so a template without `logoSlugs` still renders marks. */
export const templateProviderSlugs = (template: AgentTemplate): string[] =>
    template.logoSlugs?.length
        ? template.logoSlugs
        : template.requiredIntegrations.map((integration) => integration.slug)

/** Total tool count across a template's integrations (drawer Tools count). */
export const templateToolCount = (template: AgentTemplate): number =>
    template.requiredIntegrations.reduce((n, integration) => n + integration.tools.length, 0)

/**
 * The initial instruction message for the agent-builder flow (Mahmoud's template mode): it seeds a
 * blank agent's playground chat so the builder constructs the config, instead of writing config
 * directly. Uses the template's explicit `builderMessage` when set, else derives a build request from
 * its name + overview.
 */
export const templateBuilderMessage = (template: AgentTemplate): string =>
    template.builderMessage?.trim() ||
    `Create an agent that ${template.overview.charAt(0).toLowerCase()}${template.overview.slice(1)}`

/** Canonical chip order; only categories present in the templates render. Five visible categories
 * (Monitoring folds into Engineering) — see open-questions.md #1; revisit once there's click data. */
export const TEMPLATE_CATEGORY_ORDER = [
    "Engineering",
    "Support",
    "Sales",
    "Knowledge",
    "Ops",
] as const

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
    // Engineering (dev-workflow automation)
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
            "Build a PR reviewer that comments inline on risky changes and flags missing tests.",
        builderMessage:
            "Build a PR reviewer that comments inline on risky changes and flags missing tests.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "gitlab"],
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
        overview: "Turns merged pull requests into clean release notes and publishes them.",
        instructions:
            "Turn merged pull requests into clean, human-readable release notes and publish them.",
        toolsSummary: "2 GitHub tools",
        trigger: "On release",
        triggerDescription: "Runs when a release is published.",
        seedMessage:
            "Build a changelog writer that turns merged pull requests into release notes and publishes them.",
        builderMessage:
            "Build a changelog writer that turns merged pull requests into release notes and publishes them.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "gitlab", "notion", "linear"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read merged PRs, publish releases",
                tools: [
                    {
                        name: "List pull requests",
                        description: "Fetch the PRs merged since the last release.",
                    },
                    {
                        name: "Create release",
                        description: "Publish the release notes as a GitHub release.",
                    },
                ],
            },
        ],
    },
    {
        key: "issue-triage",
        name: "Issue triage",
        category: "Engineering",
        initials: "IT",
        color: "#4f46e5",
        description: "Labels new issues by area and priority, assigns an owner.",
        overview:
            "Labels every new issue by area and priority and assigns it to the right owner, so nothing sits untriaged.",
        instructions: "Label each new issue by area and priority and assign it to an owner.",
        toolsSummary: "2 GitHub tools",
        trigger: "Issue opened",
        triggerDescription: "Runs when a new issue is opened.",
        seedMessage:
            "Build an issue triager that labels new issues by area and priority and assigns an owner.",
        builderMessage:
            "Build an issue triager that labels new issues by area and priority and assigns an owner.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "gitlab", "linear", "jira"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read issues, apply labels & assignees",
                tools: [
                    {
                        name: "Get issue",
                        description: "Read a new issue's title and body.",
                    },
                    {
                        name: "Update issue",
                        description: "Apply labels and assign an owner.",
                    },
                ],
            },
        ],
    },
    {
        key: "ci-failure-triage",
        name: "CI failure triage",
        category: "Engineering",
        initials: "CI",
        color: "#dc2626",
        description: "Summarizes failed CI runs and pings the author.",
        overview:
            "Reads the logs when CI fails, summarizes the likely cause, and pings the author.",
        instructions:
            "When a workflow run fails, read the logs, summarize the likely cause, and comment on the commit or PR.",
        toolsSummary: "2 GitHub tools",
        trigger: "Workflow run failed",
        triggerDescription: "Runs when a CI workflow run fails.",
        seedMessage:
            "Build an agent that reads the logs when CI fails, summarizes the likely cause, and pings the author.",
        builderMessage:
            "Build an agent that reads the logs when CI fails, summarizes the likely cause, and pings the author.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "slack", "discord"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read workflow runs, comment on commits",
                tools: [
                    {
                        name: "Get workflow run logs",
                        description: "Read the failing run's logs.",
                    },
                    {
                        name: "Create commit comment",
                        description: "Post the likely cause and ping the author.",
                    },
                ],
            },
        ],
    },
    {
        key: "code-qa",
        name: "Code Q&A",
        category: "Engineering",
        initials: "QA",
        color: "#0891b2",
        description: "Answers questions about the repo when mentioned.",
        overview:
            "Answers questions about your repo when mentioned, citing the files and lines it used.",
        instructions:
            "When mentioned, search the repo and answer the question with a cited reference to the relevant code.",
        toolsSummary: "2 GitHub tools",
        trigger: "Mention",
        triggerDescription: "Runs when the agent is @-mentioned.",
        seedMessage: "Build a code Q&A agent that answers questions about our repo when mentioned.",
        builderMessage:
            "Build a code Q&A agent that answers questions about our repo when mentioned.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "gitlab", "slack"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read repo files & code",
                tools: [
                    {
                        name: "Search code",
                        description: "Find files relevant to the question.",
                    },
                    {
                        name: "Get file content",
                        description: "Read the matching file to answer accurately.",
                    },
                ],
            },
        ],
    },
    {
        key: "dependency-digest",
        name: "Dependency digest",
        category: "Engineering",
        initials: "DD",
        color: "#65a30d",
        description: "Weekly summary of open dependency-update PRs.",
        overview:
            "Every week, summarizes the open dependency-update pull requests and what changed in each.",
        instructions: "Weekly, list open dependency-update PRs and summarize what changed in each.",
        toolsSummary: "2 GitHub tools",
        trigger: "Weekly",
        triggerDescription: "Runs every week on a schedule.",
        seedMessage:
            "Build an agent that weekly summarizes open dependency-update PRs and what changed.",
        builderMessage:
            "Build an agent that weekly summarizes open dependency-update PRs and what changed.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "slack"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read pull requests",
                tools: [
                    {
                        name: "List pull requests",
                        description: "Fetch open dependency-update PRs.",
                    },
                    {
                        name: "Get pull request",
                        description: "Read what changed in each.",
                    },
                ],
            },
        ],
    },

    // Support (customer support)
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
        seedMessage:
            "Build a support triager that reads new #support threads, tags urgency, and routes to owners.",
        builderMessage:
            "Build a support triager that reads new #support threads, tags urgency, and routes to owners.",
        model: DEFAULT_MODEL,
        logoSlugs: ["slack", "discord", "intercom", "zendesk"],
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
        key: "support-reply-drafter",
        name: "Support reply drafter",
        category: "Support",
        initials: "SR",
        color: "#db2777",
        description: "Drafts replies to new tickets using your docs.",
        overview:
            "Drafts a reply to every new support ticket, using answers pulled from your docs.",
        instructions:
            "On a new ticket, draft a reply using answers from the docs workspace; leave it for review before sending.",
        toolsSummary: "2 Zendesk tools",
        trigger: "New ticket",
        triggerDescription: "Runs when a new support ticket comes in.",
        seedMessage:
            "Build an agent that drafts replies to new support tickets using answers from our docs.",
        builderMessage:
            "Build an agent that drafts replies to new support tickets using answers from our docs.",
        model: DEFAULT_MODEL,
        logoSlugs: ["zendesk", "intercom", "notion", "confluence", "googledrive", "slack"],
        requiredIntegrations: [
            {
                // CHECK confidence; required to run is zendesk (the ticket source) only.
                // intercom/notion/confluence/googledrive/slack are display-only extensions.
                slug: "zendesk",
                scope: "Read tickets, post draft replies",
                tools: [
                    {
                        name: "Get ticket",
                        description: "Read the new ticket's subject, body, and history.",
                    },
                    {
                        name: "Add comment",
                        description: "Post the drafted reply as an internal comment for review.",
                    },
                ],
            },
        ],
    },
    {
        key: "bug-report-router",
        name: "Bug report router",
        category: "Support",
        initials: "BR",
        color: "#ea580c",
        description: "Turns complaints into Linear tickets with repro steps.",
        overview:
            "Turns support complaints into Linear bug tickets, including repro steps pulled from the thread.",
        instructions:
            "When a bug is reported, extract repro steps from the thread and file a Linear ticket.",
        toolsSummary: "2 Slack + 2 Linear tools",
        trigger: "New message or mention",
        triggerDescription: "Runs on a new support message or mention.",
        seedMessage:
            "Build an agent that turns support complaints into Linear bug tickets with repro steps.",
        builderMessage:
            "Build an agent that turns support complaints into Linear bug tickets with repro steps.",
        model: DEFAULT_MODEL,
        logoSlugs: ["slack", "intercom", "zendesk", "linear", "jira", "github"],
        requiredIntegrations: [
            {
                slug: "slack",
                scope: "Read threads, confirm filed tickets",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read the complaint thread.",
                    },
                    {
                        name: "Send message",
                        description: "Confirm the filed ticket back in-thread.",
                    },
                ],
            },
            {
                // Linear is the primary bug tracker the playbook hard-requires; Jira and GitHub are
                // alternatives and stay display-only.
                slug: "linear",
                scope: "Search & create issues",
                tools: [
                    {
                        name: "Search issues",
                        description: "Check for an existing ticket on the same bug.",
                    },
                    {
                        name: "Create issue",
                        description: "File the bug ticket with the extracted repro steps.",
                    },
                ],
            },
        ],
    },
    {
        key: "feedback-clusterer",
        name: "Feedback clusterer",
        category: "Support",
        initials: "FC",
        color: "#a21caf",
        description: "Daily clusters new feedback into themes.",
        overview:
            "Each day, clusters new customer feedback into themes and logs the summary to Notion.",
        instructions: "Daily, gather new feedback, cluster it into themes, and log the summary.",
        toolsSummary: "2 Slack + 2 Notion tools",
        trigger: "Daily",
        triggerDescription: "Runs once a day on a schedule.",
        seedMessage:
            "Build an agent that daily clusters new customer feedback into themes and logs them to Notion.",
        builderMessage:
            "Build an agent that daily clusters new customer feedback into themes and logs them to Notion.",
        model: DEFAULT_MODEL,
        logoSlugs: ["intercom", "slack", "notion"],
        requiredIntegrations: [
            {
                slug: "slack",
                scope: "Read channels, post theme summaries",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read new feedback messages.",
                    },
                    {
                        name: "Send message",
                        description: "Post the theme summary.",
                    },
                ],
            },
            {
                slug: "notion",
                scope: "Log clusters to a page or database",
                tools: [
                    {
                        name: "Create page",
                        description: "Log the day's clustered themes as a page.",
                    },
                    {
                        name: "Update database",
                        description: "Append the themes as rows to a tracker database.",
                    },
                ],
            },
        ],
    },

    // Sales (leads, CRM, outreach)
    {
        key: "lead-qualifier",
        name: "Lead qualifier",
        category: "Sales",
        initials: "LQ",
        color: "#f59e0b",
        description: "Enriches and qualifies new inbound leads.",
        overview:
            "Enriches each new inbound lead, qualifies it against your criteria, and adds it to HubSpot.",
        instructions:
            "On a new lead, enrich its details, qualify it, and create or update the HubSpot record.",
        toolsSummary: "2 HubSpot tools",
        trigger: "New lead or email",
        triggerDescription: "Runs when a new lead or inbound email arrives.",
        seedMessage:
            "Build an agent that enriches each new inbound lead, qualifies it, and adds it to HubSpot.",
        builderMessage:
            "Build an agent that enriches each new inbound lead, qualifies it, and adds it to HubSpot.",
        model: DEFAULT_MODEL,
        logoSlugs: ["hubspot", "salesforce", "attio", "gmail", "slack"],
        requiredIntegrations: [
            {
                slug: "hubspot",
                scope: "Read & create contacts",
                tools: [
                    {
                        name: "Search contacts",
                        description: "Check whether the lead already exists.",
                    },
                    {
                        name: "Create contact",
                        description: "Add the qualified lead to HubSpot.",
                    },
                ],
            },
        ],
    },
    {
        key: "crm-updater",
        name: "CRM updater",
        category: "Sales",
        initials: "CU",
        color: "#0284c7",
        description: "Updates CRM records from recent email threads.",
        overview:
            "Each day, updates CRM contact records using context from your recent email threads.",
        instructions:
            "Daily, review recent email threads and update the matching CRM contact records.",
        toolsSummary: "2 Gmail tools",
        trigger: "Daily",
        triggerDescription: "Runs once a day on a schedule.",
        seedMessage:
            "Build an agent that updates CRM contact records from my recent email threads each day.",
        builderMessage:
            "Build an agent that updates CRM contact records from my recent email threads each day.",
        model: DEFAULT_MODEL,
        logoSlugs: ["gmail", "hubspot", "salesforce", "attio"],
        requiredIntegrations: [
            {
                // Required to run: gmail. The CRM (hubspot, etc.) is a pick-one write target.
                slug: "gmail",
                scope: "Read recent email threads",
                tools: [
                    {
                        name: "Fetch emails",
                        description: "List recent threads to check for CRM-relevant updates.",
                    },
                    {
                        name: "Read thread",
                        description: "Read a thread's content to extract contact updates.",
                    },
                ],
            },
        ],
    },
    {
        key: "outreach-drafter",
        name: "Outreach drafter",
        category: "Sales",
        initials: "OD",
        color: "#9333ea",
        description: "Drafts personalized outreach for a contact list.",
        overview:
            "Drafts a personalized outreach email for each contact on a CRM list, ready for review.",
        instructions:
            "Given a CRM contact list, draft a personalized outreach email for each contact.",
        toolsSummary: "2 HubSpot tools",
        trigger: "Manual",
        triggerDescription: "Runs when you ask it to draft outreach for a list.",
        seedMessage:
            "Build an agent that drafts personalized outreach emails for a list of CRM contacts.",
        builderMessage:
            "Build an agent that drafts personalized outreach emails for a list of CRM contacts.",
        model: DEFAULT_MODEL,
        logoSlugs: ["hubspot", "salesforce", "attio", "gmail"],
        requiredIntegrations: [
            {
                slug: "hubspot",
                scope: "Read contact lists",
                tools: [
                    {
                        name: "List contacts",
                        description: "Fetch the target contact list.",
                    },
                    {
                        name: "Get contact",
                        description: "Read a contact's details to personalize the draft.",
                    },
                ],
            },
        ],
    },
    {
        key: "meeting-followup",
        name: "Meeting follow-up",
        category: "Sales",
        initials: "MF",
        color: "#16a34a",
        description: "Drafts a follow-up email and logs notes to the CRM.",
        overview:
            "After each meeting, drafts a follow-up email and logs the meeting notes to the CRM.",
        instructions:
            "After a meeting, draft a follow-up email and log the notes on the matching CRM contact.",
        toolsSummary: "2 Gmail tools",
        trigger: "Meeting ends",
        triggerDescription: "Runs after a calendar meeting ends, or on schedule.",
        seedMessage:
            "Build an agent that drafts a follow-up email after each meeting and logs notes to the CRM.",
        builderMessage:
            "Build an agent that drafts a follow-up email after each meeting and logs notes to the CRM.",
        model: DEFAULT_MODEL,
        logoSlugs: ["googlecalendar", "gmail", "hubspot", "salesforce", "attio"],
        requiredIntegrations: [
            {
                // Required to run: gmail. The CRM (hubspot, etc.) is a pick-one write target.
                slug: "gmail",
                scope: "Read meeting notes, draft the follow-up",
                tools: [
                    {
                        name: "Read thread",
                        description: "Read the recap or notes email for the meeting.",
                    },
                    {
                        name: "Create draft",
                        description: "Draft the follow-up email to attendees.",
                    },
                ],
            },
        ],
    },
    {
        key: "pipeline-digest",
        name: "Pipeline digest",
        category: "Sales",
        initials: "PD",
        color: "#ca8a04",
        description: "Daily digest of pipeline changes and stale deals.",
        overview: "Posts a daily digest of pipeline changes and stale deals to Slack.",
        instructions: "Daily, summarize pipeline changes and stale deals and post the digest.",
        toolsSummary: "2 HubSpot + 2 Slack tools",
        trigger: "Daily",
        triggerDescription: "Runs once a day on a schedule.",
        seedMessage:
            "Build an agent that posts a daily digest of pipeline changes and stale deals to Slack.",
        builderMessage:
            "Build an agent that posts a daily digest of pipeline changes and stale deals to Slack.",
        model: DEFAULT_MODEL,
        logoSlugs: ["hubspot", "salesforce", "attio", "slack"],
        requiredIntegrations: [
            {
                slug: "hubspot",
                scope: "Read deals",
                tools: [
                    {
                        name: "List deals",
                        description: "Fetch deals changed since yesterday.",
                    },
                    {
                        name: "Get deal",
                        description: "Check how long a deal has been stale.",
                    },
                ],
            },
            {
                // HubSpot alternatives (Salesforce, Attio) stay display-only; Slack is the required
                // post destination.
                slug: "slack",
                scope: "Post the pipeline digest",
                tools: [
                    {
                        name: "List channels",
                        description: "Resolve the target channel to post to.",
                    },
                    {
                        name: "Send message",
                        description: "Post the pipeline digest to the channel.",
                    },
                ],
            },
        ],
    },

    // Monitoring (folded into Engineering, open question #1)
    {
        key: "incident-responder",
        name: "Incident responder",
        category: "Engineering",
        initials: "!",
        color: "#f97316",
        description: "Watches alerts, gathers context, pages on-call.",
        overview:
            "Watches your alerts. Gathers related context and logs, summarizes the likely cause, and pages the on-call engineer.",
        instructions:
            "On an alert, gather context and logs, summarize the likely cause, and page the on-call engineer.",
        toolsSummary: "2 Sentry + 2 Slack tools",
        trigger: "On alert",
        triggerDescription: "Runs when a new alert fires.",
        seedMessage:
            "Build an incident responder that gathers context on new alerts and pages on-call.",
        builderMessage:
            "Build an incident responder that gathers context on new alerts and pages on-call.",
        model: DEFAULT_MODEL,
        logoSlugs: ["sentry", "datadog", "newrelic", "pagerduty", "slack"],
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
                // Slack is the SOLID notify target the playbook always posts to; PagerDuty is the
                // alternative page target and stays display-only.
                slug: "slack",
                scope: "Post the incident summary",
                tools: [
                    {
                        name: "List channels",
                        description: "Resolve the alerts channel to post to.",
                    },
                    {
                        name: "Send message",
                        description: "Post the incident summary to the channel.",
                    },
                ],
            },
        ],
    },
    {
        key: "error-triage",
        name: "Error triage",
        category: "Engineering",
        initials: "ET",
        color: "#be123c",
        description: "Triages new Sentry errors by severity, files real ones.",
        overview:
            "Triages every new Sentry error by severity and files a ticket for the ones that are real.",
        instructions:
            "On a new error, assess severity; file a ticket only for errors that are real and actionable.",
        toolsSummary: "2 Sentry + 2 Linear tools",
        trigger: "New error",
        triggerDescription: "Runs when a new Sentry error is captured.",
        seedMessage:
            "Build an agent that triages new Sentry errors by severity and files a ticket for real ones.",
        builderMessage:
            "Build an agent that triages new Sentry errors by severity and files a ticket for real ones.",
        model: DEFAULT_MODEL,
        logoSlugs: ["sentry", "linear", "jira"],
        requiredIntegrations: [
            {
                slug: "sentry",
                scope: "Read issues",
                tools: [
                    {
                        name: "Get issue",
                        description: "Read the new error's stack trace and events.",
                    },
                    {
                        name: "List issues",
                        description: "Check whether it's a duplicate of a known error.",
                    },
                ],
            },
            {
                // Linear is the primary filing destination the playbook hard-requires; Jira is the
                // alternative and stays display-only.
                slug: "linear",
                scope: "Search & create issues",
                tools: [
                    {
                        name: "Search issues",
                        description: "Rule out a duplicate before filing.",
                    },
                    {
                        name: "Create issue",
                        description: "File a ticket for a real, actionable error.",
                    },
                ],
            },
        ],
    },
    {
        key: "uptime-reporter",
        name: "Uptime reporter",
        category: "Engineering",
        initials: "UR",
        color: "#0d9488",
        description: "Daily uptime and error-rate summary to Slack.",
        overview: "Posts a daily summary of uptime and error rates to Slack.",
        instructions: "Daily, summarize uptime and error rates and post the digest.",
        toolsSummary: "2 Sentry + 2 Slack tools",
        trigger: "Daily",
        triggerDescription: "Runs once a day on a schedule.",
        seedMessage: "Build an agent that posts a daily uptime and error-rate summary to Slack.",
        builderMessage: "Build an agent that posts a daily uptime and error-rate summary to Slack.",
        model: DEFAULT_MODEL,
        logoSlugs: ["datadog", "newrelic", "sentry", "slack"],
        requiredIntegrations: [
            {
                // Sentry is the required error source; Datadog and New Relic stay display-only
                // context extensions.
                slug: "sentry",
                scope: "Read issues",
                tools: [
                    {
                        name: "List issues",
                        description: "Count errors captured in the last day.",
                    },
                    {
                        name: "Get issue",
                        description: "Check status of ongoing errors.",
                    },
                ],
            },
            {
                // Slack is the required post destination the playbook posts every digest to.
                slug: "slack",
                scope: "Post the daily summary",
                tools: [
                    {
                        name: "List channels",
                        description: "Resolve the channel to post to.",
                    },
                    {
                        name: "Send message",
                        description: "Post the daily uptime and error-rate summary.",
                    },
                ],
            },
        ],
    },
    {
        key: "oncall-briefer",
        name: "On-call briefer",
        category: "Engineering",
        initials: "OC",
        color: "#7c2d12",
        description: "Briefs on-call with open incidents each morning.",
        overview:
            "Every morning, briefs the on-call engineer with all open incidents and their status.",
        instructions:
            "On schedule, list open incidents and their status and post the on-call brief.",
        toolsSummary: "2 Sentry + 2 Slack tools",
        trigger: "Daily at 09:00",
        triggerDescription: "Runs every day at 09:00.",
        seedMessage:
            "Build an agent that briefs on-call at 09:00 with all open incidents and their status.",
        builderMessage:
            "Build an agent that briefs on-call at 09:00 with all open incidents and their status.",
        model: DEFAULT_MODEL,
        logoSlugs: ["pagerduty", "sentry", "slack"],
        requiredIntegrations: [
            {
                // Sentry is the required incident source; PagerDuty stays a display-only extension
                // for naming the on-call engineer.
                slug: "sentry",
                scope: "Read issues",
                tools: [
                    {
                        name: "List issues",
                        description: "Fetch currently open incidents.",
                    },
                    {
                        name: "Get issue",
                        description: "Read each incident's status.",
                    },
                ],
            },
            {
                // Slack is the required post destination the playbook posts every briefing to.
                slug: "slack",
                scope: "Post the on-call briefing",
                tools: [
                    {
                        name: "List channels",
                        description: "Resolve the channel to post to.",
                    },
                    {
                        name: "Send message",
                        description: "Post the on-call briefing to the channel.",
                    },
                ],
            },
        ],
    },

    // Knowledge (Q&A bots, docs, content)
    {
        key: "docs-qa",
        name: "Docs Q&A",
        category: "Knowledge",
        initials: "Q",
        color: "#1c2c3d",
        description: "Answers questions from your docs workspace.",
        overview:
            "Answers questions from your docs workspace with concise, cited answers — in chat or on mention.",
        instructions:
            "Answer questions by searching the docs workspace; return a concise, cited answer.",
        toolsSummary: "2 Notion tools",
        trigger: "On mention",
        triggerDescription: "Runs when the agent is @-mentioned.",
        seedMessage:
            "Build a docs Q&A agent that answers questions from our workspace with cited answers.",
        builderMessage:
            "Build a docs Q&A agent that answers questions from our workspace with cited answers.",
        model: DEFAULT_MODEL,
        logoSlugs: ["notion", "confluence", "googledrive", "slack"],
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
        ],
    },
    {
        key: "knowledge-chatbot",
        name: "Knowledge chatbot",
        category: "Knowledge",
        initials: "KC",
        color: "#2563eb",
        description: "Customer-facing chatbot answering from your knowledge base.",
        overview: "Answers customer questions from your knowledge base, in chat or when mentioned.",
        instructions:
            "Answer customer questions by searching the knowledge base; return a concise, cited answer.",
        toolsSummary: "2 Notion + 2 Slack tools",
        trigger: "Mention or new message",
        triggerDescription: "Runs on mention or a new customer message.",
        seedMessage:
            "Build a customer-facing chatbot that answers questions from our knowledge base.",
        builderMessage:
            "Build a customer-facing chatbot that answers questions from our knowledge base.",
        model: DEFAULT_MODEL,
        logoSlugs: ["notion", "confluence", "googledrive", "slack", "discord", "telegram"],
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
                        description: "Read the page to draft a cited answer.",
                    },
                ],
            },
            {
                // Slack is the primary reply platform the playbook hard-requires; Discord and
                // Telegram are alternatives and stay display-only.
                slug: "slack",
                scope: "Reply to customer questions",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read the incoming question thread.",
                    },
                    {
                        name: "Send message",
                        description: "Reply in-thread with the cited answer.",
                    },
                ],
            },
        ],
    },
    {
        key: "onboarding-buddy",
        name: "Onboarding buddy",
        category: "Knowledge",
        initials: "OB",
        color: "#0369a1",
        description: "Answers new-hire questions from your internal wiki.",
        overview: "Answers new-hire questions by searching your internal wiki, on mention.",
        instructions:
            "When mentioned, search the internal wiki and answer the new hire's question.",
        toolsSummary: "2 Notion + 2 Slack tools",
        trigger: "Mention",
        triggerDescription: "Runs when the agent is @-mentioned.",
        seedMessage:
            "Build an onboarding buddy that answers new-hire questions from our internal wiki.",
        builderMessage:
            "Build an onboarding buddy that answers new-hire questions from our internal wiki.",
        model: DEFAULT_MODEL,
        logoSlugs: ["notion", "confluence", "slack"],
        requiredIntegrations: [
            {
                slug: "notion",
                scope: "Read pages",
                tools: [
                    {
                        name: "Search",
                        description: "Find wiki pages relevant to the question.",
                    },
                    {
                        name: "Get page content",
                        description: "Read the page to answer accurately.",
                    },
                ],
            },
            {
                // Notion alternative Confluence stays display-only; Slack is the required reply
                // channel.
                slug: "slack",
                scope: "Answer @mentions in-thread",
                tools: [
                    {
                        name: "Fetch conversation history",
                        description: "Read the new hire's mention thread.",
                    },
                    {
                        name: "Send message",
                        description: "Reply in-thread with the cited answer.",
                    },
                ],
            },
        ],
    },
    {
        key: "content-repurposer",
        name: "Content repurposer",
        category: "Knowledge",
        initials: "CR",
        color: "#be185d",
        description: "Turns a published doc into draft social posts.",
        overview: "Turns a published doc into draft LinkedIn and X posts, ready for review.",
        instructions:
            "Given a published doc, draft a LinkedIn post and an X post from its content.",
        toolsSummary: "2 Notion tools",
        trigger: "Manual",
        triggerDescription: "Runs when you point it at a doc to repurpose.",
        seedMessage:
            "Build an agent that turns a published doc into draft LinkedIn and X posts for review.",
        builderMessage:
            "Build an agent that turns a published doc into draft LinkedIn and X posts for review.",
        model: DEFAULT_MODEL,
        logoSlugs: ["notion", "googledrive", "slack"],
        requiredIntegrations: [
            {
                slug: "notion",
                scope: "Read & create pages",
                tools: [
                    {
                        name: "Get page content",
                        description: "Read the published doc.",
                    },
                    {
                        name: "Create page",
                        description: "Save the drafts for review.",
                    },
                ],
            },
        ],
    },
    {
        key: "newsletter-drafter",
        name: "Newsletter drafter",
        category: "Knowledge",
        initials: "ND",
        color: "#7e22ce",
        description: "Weekly newsletter drafted from shipping activity.",
        overview: "Each week, drafts a newsletter summarizing recent shipping activity.",
        instructions: "Weekly, gather recent shipping activity and draft the newsletter.",
        toolsSummary: "2 Notion + 2 GitHub tools",
        trigger: "Weekly",
        triggerDescription: "Runs every week on a schedule.",
        seedMessage:
            "Build an agent that drafts a weekly newsletter from our recent shipping activity.",
        builderMessage:
            "Build an agent that drafts a weekly newsletter from our recent shipping activity.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "notion", "linear"],
        requiredIntegrations: [
            {
                slug: "notion",
                scope: "Read & create pages",
                tools: [
                    {
                        name: "Search",
                        description: "Find last week's shipping notes.",
                    },
                    {
                        name: "Create page",
                        description: "Draft the newsletter page.",
                    },
                ],
            },
            {
                // A shipping source is required; GitHub is the primary one. Linear is the swappable
                // alternative source and stays display-only.
                slug: "github",
                scope: "Read merged PRs",
                tools: [
                    {
                        name: "List pull requests",
                        description: "Fetch PRs merged since the last newsletter.",
                    },
                    {
                        name: "Get pull request",
                        description: "Read merge details to summarize what shipped.",
                    },
                ],
            },
        ],
    },

    // Ops (digests, reporting, cross-tool syncs)
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
        seedMessage:
            "Build an agent that posts a daily standup digest of yesterday's channel activity.",
        builderMessage:
            "Build an agent that posts a daily standup digest of yesterday's channel activity.",
        model: DEFAULT_MODEL,
        logoSlugs: ["slack", "discord"],
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
        key: "repo-slack-digest",
        name: "Repo Slack digest",
        category: "Ops",
        initials: "RD",
        color: "#334155",
        description: "Twice-daily digest of issues, commits, and PRs.",
        overview: "Twice a day, posts a digest of new issues, commits, and PRs to Slack.",
        instructions: "Twice daily, summarize new issues, commits, and PRs and post the digest.",
        toolsSummary: "2 GitHub + 2 Slack tools",
        trigger: "2x daily",
        triggerDescription: "Runs twice a day on a schedule.",
        seedMessage:
            "Build an agent that twice a day posts a digest of new issues, commits, and PRs to Slack.",
        builderMessage:
            "Build an agent that twice a day posts a digest of new issues, commits, and PRs to Slack.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "slack"],
        requiredIntegrations: [
            {
                slug: "github",
                scope: "Read issues & pull requests",
                tools: [
                    {
                        name: "List issues",
                        description: "Fetch issues opened since the last digest.",
                    },
                    {
                        name: "List pull requests",
                        description: "Fetch PRs opened or merged since the last digest.",
                    },
                ],
            },
            {
                // GitHub alternative GitLab and Slack alternative Discord stay display-only; Slack is
                // the primary required post destination.
                slug: "slack",
                scope: "Post the repo digest",
                tools: [
                    {
                        name: "List channels",
                        description: "Resolve the channel to post to.",
                    },
                    {
                        name: "Send message",
                        description: "Post the grouped repo digest to the channel.",
                    },
                ],
            },
        ],
    },
    {
        key: "cross-tool-sync",
        name: "Cross-tool sync",
        category: "Ops",
        initials: "CS",
        color: "#0f766e",
        description: "Mirrors new Linear issues into a Notion tracker.",
        overview: "Mirrors new Linear issues into a Notion tracker on a schedule.",
        instructions:
            "On schedule, find new Linear issues and mirror them into the Notion tracker.",
        toolsSummary: "2 Linear + 2 Notion tools",
        trigger: "Hourly",
        triggerDescription: "Runs every hour on a schedule.",
        seedMessage:
            "Build an agent that mirrors new Linear issues into a Notion tracker every hour.",
        builderMessage:
            "Build an agent that mirrors new Linear issues into a Notion tracker every hour.",
        model: DEFAULT_MODEL,
        logoSlugs: ["linear", "jira", "github", "notion"],
        requiredIntegrations: [
            {
                slug: "linear",
                scope: "Read issues",
                tools: [
                    {
                        name: "List issues",
                        description: "Fetch issues created since the last sync.",
                    },
                    {
                        name: "Get issue",
                        description: "Read an issue's details to mirror.",
                    },
                ],
            },
            {
                // Source alternative Jira and destination alternatives Confluence/GitHub stay
                // display-only; Linear and Notion are the primary source and destination.
                slug: "notion",
                scope: "Create & update tracker pages",
                tools: [
                    {
                        name: "Query database",
                        description: "Find an existing mirror by the source issue id.",
                    },
                    {
                        name: "Create page",
                        description: "Upsert a tracker row for each new source issue.",
                    },
                ],
            },
        ],
    },
    {
        key: "weekly-report",
        name: "Weekly report",
        category: "Ops",
        initials: "WR",
        color: "#c2410c",
        description: "Weekly report of shipping and product metrics.",
        overview:
            "Each week, compiles a report of shipping activity and product metrics to Notion.",
        instructions:
            "Weekly, gather shipping activity and product metrics and compile the report.",
        toolsSummary: "2 GitHub + 2 Notion tools",
        trigger: "Weekly",
        triggerDescription: "Runs every week on a schedule.",
        seedMessage:
            "Build an agent that compiles a weekly report of shipping and product metrics to Notion.",
        builderMessage:
            "Build an agent that compiles a weekly report of shipping and product metrics to Notion.",
        model: DEFAULT_MODEL,
        logoSlugs: ["github", "linear", "posthog", "notion", "slack"],
        requiredIntegrations: [
            {
                // GitHub is the required shipping source every report depends on; PostHog and Linear
                // stay display-only optional extensions.
                slug: "github",
                scope: "Read pull requests",
                tools: [
                    {
                        name: "List pull requests",
                        description: "Fetch what shipped this week.",
                    },
                    {
                        name: "Get pull request",
                        description: "Read merge details for the report.",
                    },
                ],
            },
            {
                // Notion is the primary required publish target; Slack is the alternative and stays
                // display-only.
                slug: "notion",
                scope: "Publish the report",
                tools: [
                    {
                        name: "Create page",
                        description: "Publish the weekly report as a page.",
                    },
                    {
                        name: "Update page",
                        description: "Update an existing report page in place.",
                    },
                ],
            },
        ],
    },
]
