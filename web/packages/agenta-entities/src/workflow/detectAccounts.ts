/**
 * Which accounts a new agent will need, resolved before it is created (#6043).
 *
 * Two signals, and the difference between them is load-bearing:
 *  - a TEMPLATE declares its integrations exactly (`requiredIntegrations`) → `required`, gates create;
 *  - a free-text DESCRIPTION is only string-matched against the provider catalogue → suggested,
 *    never gates. A keyword guess may offer, never obstruct.
 *
 * Pure and network-free, so a backend that plans the account list pre-commit can replace the
 * text half wholesale behind this same return type.
 */
import {PROVIDERS, templateConnections, type AgentStarterTemplate} from "./agentTemplates"

export interface DetectedAccount {
    /** `PROVIDERS` key / Composio integration slug. */
    slug: string
    label: string
    logo?: string
    /** One line on what the agent does with it — the row's subtitle. */
    why: string
    /** Where it came from. Decides gating; `"text"` is never required. */
    origin: "template" | "text"
    required: boolean
}

/**
 * Phrases whose only plausible reading is that integration. Anything ambiguous is left out on
 * purpose — an unmatched account costs one click in the picker, a wrong one costs trust.
 * A phrase may map to several slugs (a "ticket" is a Linear or a Jira issue); all are offered.
 */
const ALIASES: {phrase: string; slugs: string[]}[] = [
    {phrase: "pull request", slugs: ["github"]},
    {phrase: "pull requests", slugs: ["github"]},
    {phrase: "pr", slugs: ["github"]},
    {phrase: "prs", slugs: ["github"]},
    {phrase: "repo", slugs: ["github"]},
    {phrase: "repos", slugs: ["github"]},
    {phrase: "repository", slugs: ["github"]},
    {phrase: "repositories", slugs: ["github"]},
    {phrase: "inbox", slugs: ["gmail"]},
    {phrase: "email", slugs: ["gmail"]},
    {phrase: "e-mail", slugs: ["gmail"]},
    {phrase: "emails", slugs: ["gmail"]},
    {phrase: "calendar", slugs: ["googlecalendar"]},
    {phrase: "meeting", slugs: ["googlecalendar"]},
    {phrase: "meetings", slugs: ["googlecalendar"]},
    {phrase: "issue tracker", slugs: ["linear", "jira"]},
    {phrase: "ticket", slugs: ["linear", "jira"]},
    {phrase: "tickets", slugs: ["linear", "jira"]},
    {phrase: "wiki", slugs: ["notion", "confluence"]},
    {phrase: "on-call", slugs: ["pagerduty"]},
    {phrase: "oncall", slugs: ["pagerduty"]},
    {phrase: "incident", slugs: ["pagerduty"]},
    {phrase: "incidents", slugs: ["pagerduty"]},
]

/**
 * Several provider names are also ordinary English ("slack", "notion", "linear"), so a
 * whole-word match alone is not enough — "linear algebra" and "the notion that" are both
 * whole-word hits. An occurrence is rejected when its immediate context matches one of these.
 * `head` is the ~24 chars before it, `tail` the ~24 after; both lowercased.
 */
const NEGATIVE_CONTEXT: Record<string, {head?: RegExp; tail?: RegExp}> = {
    linear: {tail: /^\s+(algebra|regression|model|programming|search|scale|time|combination)/},
    // Only the idiomatic readings. "the Notion database" and "the Slack channel" are real
    // mentions, so nothing keys on a bare leading article.
    notion: {tail: /^\s+(of|that)\b/},
    slack: {head: /\b(cut|cutting|some)\s+$/, tail: /^\s+off\b/},
    discord: {tail: /^\s+(between|among|amongst)\b/},
}

/**
 * Only a TEMPLATE has something per-account to say (its scope line). A detected or hand-added
 * row does not: every one of them would repeat the same sentence, which is noise stacked down
 * the card and truncates mid-word at a phone's row width. The card's lead says it once instead.
 */
const NO_SCOPE_LINE = ""

const CONTEXT_WINDOW = 24

/**
 * Index of the first occurrence of `needle` in `haystack` (both lowercased) that reads as a real
 * mention: delimited by non-alphanumerics on both sides (so "hub" misses GitHub and "slacks"
 * misses Slack) and not in one of `slug`'s rejected contexts. `-1` when there is none.
 */
const mentionIndex = (haystack: string, needle: string, slug: string): number => {
    if (!needle) return -1
    const negative = NEGATIVE_CONTEXT[slug]
    let from = 0
    for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) return -1
        from = at + 1
        const before = at === 0 ? "" : haystack[at - 1]
        const end = at + needle.length
        const after = haystack[end] ?? ""
        if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue
        if (negative) {
            const head = haystack.slice(Math.max(0, at - CONTEXT_WINDOW), at)
            const tail = haystack.slice(end, end + CONTEXT_WINDOW)
            if (negative.head?.test(head) || negative.tail?.test(tail)) continue
        }
        return at
    }
}

/** Where in the description a slug is first mentioned; `-1` when it isn't. */
const firstMentionIndex = (text: string, slug: string): number => {
    const provider = PROVIDERS[slug]
    const terms = [provider?.label.toLowerCase(), slug].filter((term): term is string => !!term)
    for (const {phrase, slugs} of ALIASES) {
        if (slugs.includes(slug)) terms.push(phrase)
    }
    let earliest = -1
    for (const term of terms) {
        const at = mentionIndex(text, term, slug)
        if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at
    }
    return earliest
}

/**
 * Accounts mentioned in a free-text description, in the order the user mentioned them — their
 * own emphasis orders the rows better than the catalogue does.
 */
export function detectAccountsFromText(description: string): DetectedAccount[] {
    const text = (description ?? "").toLowerCase()
    if (!text.trim()) return []

    const hits: {slug: string; at: number}[] = []
    for (const slug of Object.keys(PROVIDERS)) {
        const at = firstMentionIndex(text, slug)
        if (at !== -1) hits.push({slug, at})
    }

    return hits
        .sort((a, b) => a.at - b.at)
        .map(({slug}) => ({
            slug,
            label: PROVIDERS[slug].label,
            logo: PROVIDERS[slug].logo,
            why: NO_SCOPE_LINE,
            origin: "text" as const,
            required: false,
        }))
}

/** A template's declared integrations — exact, and the only accounts allowed to gate create. */
/**
 * One connection the template needs, and every provider that can satisfy it. A slot with two
 * options is the playbook's "GitHub (or GitLab)": connecting EITHER settles it, so a GitLab user
 * is never told to connect GitHub.
 */
export interface DetectedAccountGroup {
    /** What the slot is for — the row's heading when the options are shown as a choice. */
    role: string
    /** Gates Create only when true; an optional slot is offered, never demanded. */
    required: boolean
    /** Interchangeable accounts, primary first. */
    options: DetectedAccount[]
}

const toAccount = (
    integration: {slug: string; scope: string},
    required: boolean,
): DetectedAccount => {
    const provider = PROVIDERS[integration.slug]
    return {
        slug: integration.slug,
        label: provider?.label ?? integration.slug,
        logo: provider?.logo,
        why: integration.scope,
        origin: "template" as const,
        required,
    }
}

/** The template's slots, each with its interchangeable options. */
export function detectAccountGroupsFromTemplate(
    template: AgentStarterTemplate,
): DetectedAccountGroup[] {
    return templateConnections(template).map((connection) => ({
        role: connection.role,
        required: connection.required,
        options: connection.options.map((option) => toAccount(option, connection.required)),
    }))
}

/**
 * Flat view of a template's accounts, primary option per slot.
 *
 * An alternative is deliberately NOT flattened in: it would read as a second thing to connect
 * rather than a substitute for the first. Surfaces that can render a choice take the groups.
 */
export function detectAccountsFromTemplate(template: AgentStarterTemplate): DetectedAccount[] {
    return detectAccountGroupsFromTemplate(template)
        .map((group) => group.options[0])
        .filter(Boolean)
}

/**
 * The accounts the setup step offers, template-declared first (they gate) then text matches.
 * Deduped by slug with the template entry winning — it carries the real scope line.
 */
export function detectAccounts({
    description,
    template,
}: {
    description?: string
    template?: AgentStarterTemplate
}): DetectedAccount[] {
    const fromTemplate = template ? detectAccountsFromTemplate(template) : []
    const seen = new Set(fromTemplate.map((account) => account.slug))
    const fromText = detectAccountsFromText(description ?? "").filter(
        (account) => !seen.has(account.slug),
    )
    return [...fromTemplate, ...fromText]
}

/** Create is gated on the required accounts only — never on a text guess (#6043 D2). */
export const requiredAccounts = (accounts: DetectedAccount[]): DetectedAccount[] =>
    accounts.filter((account) => account.required)

/**
 * The accounts offered as chips when detection found little or nothing — the most commonly
 * connected ones, minus whatever is already on the card. Ordered, not ranked: this is a
 * shortcut past the catalogue search, not a recommendation.
 */
const COMMON_SLUGS = ["github", "slack", "gmail", "notion", "linear", "googlecalendar"]

export function suggestionAccounts(existing: DetectedAccount[], limit = 3): DetectedAccount[] {
    const taken = new Set(existing.map((account) => account.slug))
    const suggestions: DetectedAccount[] = []
    for (const slug of COMMON_SLUGS) {
        if (suggestions.length >= limit) break
        if (taken.has(slug) || !PROVIDERS[slug]) continue
        suggestions.push({
            slug,
            label: PROVIDERS[slug].label,
            logo: PROVIDERS[slug].logo,
            why: NO_SCOPE_LINE,
            origin: "text",
            required: false,
        })
    }
    return suggestions
}
