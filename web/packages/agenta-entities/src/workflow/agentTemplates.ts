/**
 * Agent starter templates for every create surface. The API's template catalog is the only data
 * source (`agentTemplatesAtom`); this module holds the card shape and pure helpers over it.
 */

import type {AgentaApi} from "@agentaai/api-client"

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
    /** Per-template scope line shown in the setup drawer (the package's setup notes). */
    scope?: string
    /**
     * Tools the template calls on this integration — drive the Tools preview's provider group.
     * Absent where the playbook names the connection but not the calls, which is honest: the
     * alternative to inventing a list is not having one.
     */
    tools?: TemplateTool[]
}

/**
 * One connection SLOT, named by what the template needs it for and satisfied by any ONE of its
 * options. This is the shape the playbooks already describe in prose — "GitHub (or GitLab) to
 * read the diff", "Slack or Discord are optional" — which a flat required/logo split could not
 * express: it could say GitLab existed, never that it stood in for GitHub.
 *
 * Every provider mark on a card is derived from these options, so the logos cannot drift from
 * the connections the way a separately-kept list did.
 */
export interface TemplateConnection {
    /** Stable package binding key. */
    key: string
    /** What the slot is for, in the playbook's words: "read the diff and post review comments". */
    role: string
    /** False for a slot the playbook calls optional — it never gates Create. */
    required: boolean
    /**
     * The provider this template is written against: the one with a scope line and a tool list,
     * the one the Tools preview shows, and the mark a truncated card keeps.
     */
    primary: RequiredIntegration
    /**
     * Providers that satisfy the slot instead. Slug only, deliberately: a playbook says "or
     * GitLab" and never names GitLab's tools, so anything richer here would be invented rather
     * than mirrored.
     */
    alternatives?: string[]
}

/**
 * An illustrative run, authored alongside the template.
 *
 * Shaped so it can later be POPULATED rather than written: every field is something a real
 * session already produces (the opening message, the step labels, the closing reply, the files it
 * wrote, the gate it stopped at), so a backend that captures a redacted real run can fill this in
 * without the detail page changing. Until then it is hand-written and labelled as an example.
 */
export interface TemplateExampleSession {
    /** What started the run — a message, or the trigger firing. */
    prompt: string
    /** What the agent did, one line per step. */
    steps: string[]
    /** How it reported back. */
    reply: string
    /** Files it produced, if any. */
    artifacts?: string[]
    /** Where it stopped, if it stopped for you (e.g. "Awaiting approval"). */
    status?: string
}

export interface AgentStarterTemplate {
    key: string
    source: {kind: "internal"; key: string}
    name: string
    /** Primary category for the Home filter chips. */
    category: string
    /** Monogram shown in the colored tile. */
    initials: string
    /**
     * Tile accent (inline style), cycling the categorical solids in fixed order. Monograms render
     * WHITE initials on it, so only the white-safe deep steps are used — and the same set covers
     * both themes, since the initials are hardcoded white at every render site.
     */
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
    /** An illustrative run. Absent where none has been authored — the section is skipped. */
    example?: TemplateExampleSession
    /** Pre-filled playground message, auto-sent on entering a Ready playground. */
    seedMessage: string
    /**
     * Optional initial instruction for the agent-BUILDER flow: the message seeded into a blank
     * agent's playground chat so the builder configures it. Falls back to a derived phrasing (see
     * {@link templateBuilderMessage}) when omitted.
     */
    builderMessage?: string
    /** Default model (Agenta-managed · Pi). */
    model: string
    /** What the template needs connected, and what may stand in for each. */
    connections: TemplateConnection[]
}

/** An integration slug's brand logo URL (Composio logo CDN, the tool catalog's source). */
export const composioLogo = (slug: string) => `https://logos.composio.dev/api/${slug}`

/** Provider slug → display label + brand logo URL. */
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

/**
 * What KIND of service each provider is — the vocabulary for naming a connection slot by its
 * NEED. A slot titled by its primary provider misleads the moment it offers alternatives
 * ("HubSpot · Optional" over a HubSpot/Salesforce/Attio choice), so a slot whose options all
 * share one category is named by the category instead.
 */
const PROVIDER_CATEGORY: Record<string, string> = {
    github: "Source control",
    gitlab: "Source control",
    slack: "Team chat",
    discord: "Team chat",
    telegram: "Team chat",
    notion: "Docs",
    confluence: "Docs",
    googledrive: "Docs",
    linear: "Issue tracking",
    jira: "Issue tracking",
    datadog: "Monitoring",
    newrelic: "Monitoring",
    sentry: "Monitoring",
    pagerduty: "On-call",
    hubspot: "CRM",
    salesforce: "CRM",
    attio: "CRM",
    intercom: "Support desk",
    zendesk: "Support desk",
    gmail: "Email",
    googlecalendar: "Calendar",
    posthog: "Analytics",
}

/**
 * The need's short name for a slot with a CHOICE of provider — the category the options share,
 * or nothing when they span categories (a mixed slot is honestly named by its preferred
 * provider, the existing behavior).
 */
export const connectionNeedLabel = (slugs: string[]): string | undefined => {
    const categories = slugs.map((slug) => PROVIDER_CATEGORY[slug])
    if (categories.some((category) => !category)) return undefined
    return new Set(categories).size === 1 ? categories[0] : undefined
}

/** What the template needs connected. */
export function templateConnections(template: AgentStarterTemplate): TemplateConnection[] {
    return template.connections
}

/** Integration slugs a template touches (card provider marks) — every provider its slots
 * accept, primary first. */
export const templateProviderSlugs = (template: AgentStarterTemplate): string[] => {
    // Derived, so a mark can only name a provider some slot accepts — and the PRIMARY leads,
    // because a card that overlaps or truncates its marks shows the first one.
    const slugs = templateConnections(template).flatMap((connection) => [
        connection.primary.slug,
        ...(connection.alternatives ?? []),
    ])
    return [...new Set(slugs)]
}

/**
 * The provider a surface should lead with — the first option of the first slot. Anywhere that
 * shows fewer marks than the template has, this is the one that must survive.
 */
export const templatePrimaryProvider = (template: AgentStarterTemplate): string | undefined =>
    templateConnections(template)[0]?.primary.slug

/** Total tool count across a template's integrations (drawer Tools count). */
export const templateToolCount = (template: AgentStarterTemplate): number =>
    templateConnections(template).reduce((n, slot) => n + (slot.primary.tools?.length ?? 0), 0)

/**
 * The initial instruction message for the agent-builder flow (Mahmoud's template mode): it seeds a
 * blank agent's playground chat so the builder constructs the config, instead of writing config
 * directly. Uses the template's explicit `builderMessage` when set, else derives a build request from
 * its name + overview.
 */
export const templateBuilderMessage = (template: AgentStarterTemplate): string =>
    template.builderMessage?.trim() ||
    `Create an agent that ${template.overview.charAt(0).toLowerCase()}${template.overview.slice(1)}`

/**
 * What picking a template MEANS, for every surface that offers one: create an agent under the
 * template's name, seeded with its builder instruction.
 *
 * Only the seed's DELIVERY is per-app (the desktop stashes a first-run seed and lands in the
 * playground; mobile stashes a pending task and lands in the session), so that stays with the host.
 * Deciding what the new agent is called and what it is told must not.
 */
export const agentTemplateSeed = (
    template: AgentStarterTemplate,
): {name: string; seedMessage: string} => ({
    name: template.name,
    seedMessage: templateBuilderMessage(template),
})

/** Look a template up by key — surfaces receive a key from a menu, a URL or a card. */
export const agentTemplateByKey = (
    templates: readonly AgentStarterTemplate[],
    key: string | null | undefined,
): AgentStarterTemplate | undefined =>
    key ? templates.find((template) => template.key === key) : undefined

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
export const templateCategories = (templates: readonly AgentStarterTemplate[]): string[] =>
    TEMPLATE_CATEGORY_ORDER.filter((category) =>
        templates.some((template) => template.category === category),
    )

/** URL slug ⇄ category label (gallery deep-link `?category=engineering`). */
export const categorySlug = (category: string): string => category.toLowerCase()

export const categoryFromSlug = (
    slug: string | undefined,
    templates: readonly AgentStarterTemplate[],
): string =>
    templateCategories(templates).find(
        (category) => categorySlug(category) === slug?.toLowerCase(),
    ) ?? ALL_TEMPLATES_CATEGORY

/**
 * The card shape for one catalog API entry. A field rename only: fallbacks and derived summaries
 * belong to the API's catalog reader, so nothing is filled in here.
 */
export const agentStarterTemplateFromEntry = (
    entry: AgentaApi.AgentTemplateEntry,
): AgentStarterTemplate => ({
    key: entry.key,
    source: {kind: "internal", key: entry.source.key},
    name: entry.name,
    category: entry.category,
    initials: entry.initials,
    color: entry.color,
    description: entry.summary,
    overview: entry.description,
    instructions: entry.instructions_summary,
    toolsSummary: entry.tools_summary,
    trigger: entry.trigger,
    triggerDescription: entry.trigger_description,
    ...(entry.example
        ? {
              example: {
                  prompt: entry.example.prompt,
                  steps: entry.example.steps,
                  reply: entry.example.reply,
                  ...(entry.example.artifacts ? {artifacts: entry.example.artifacts} : {}),
                  ...(entry.example.status ? {status: entry.example.status} : {}),
              },
          }
        : {}),
    seedMessage: entry.seed_message,
    builderMessage: entry.builder_message,
    model: entry.model,
    connections: entry.connections.map((connection) => ({
        key: connection.key,
        role: connection.role,
        required: connection.required,
        primary: {
            slug: connection.primary.slug,
            ...(connection.primary.scope ? {scope: connection.primary.scope} : {}),
            ...(connection.primary.tools ? {tools: connection.primary.tools} : {}),
        },
        ...(connection.alternatives?.length ? {alternatives: connection.alternatives} : {}),
    })),
})
