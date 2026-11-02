/** Human labels for dotted audit event types; the raw type stays the filter value. */

/** [singular, plural] for each known resource segment. */
const NOUNS: Record<string, [string, string]> = {
    applications: ["application", "applications"],
    environments: ["environment", "environments"],
    evaluators: ["evaluator", "evaluators"],
    gateways: ["gateway", "gateways"],
    queries: ["query", "queries"],
    revisions: ["revision", "revisions"],
    subscriptions: ["subscription", "subscriptions"],
    testcases: ["test case", "test cases"],
    testsets: ["test set", "test sets"],
    traces: ["trace", "traces"],
    webhooks: ["webhook", "webhooks"],
    workflows: ["workflow", "workflows"],
}

/** Group order in the filter: what people audit most first. */
const GROUP_ORDER = [
    "workflows",
    "environments",
    "testsets",
    "testcases",
    "queries",
    "traces",
    "gateways",
    "webhooks",
]

/** Actions that touch many records read in the plural. */
const PLURAL_ACTIONS = new Set(["queried"])

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text)

const noun = (segment: string, plural: boolean): string => {
    const known = NOUNS[segment]
    if (known) return known[plural ? 1 : 0]
    const words = segment.replace(/[_-]+/g, " ")
    return plural || !words.endsWith("s") ? words : words.slice(0, -1)
}

/** "Committed workflow revision", "Queried traces", "Viewed workflow revision log". */
export const eventTypeLabel = (eventType: string): string => {
    const segments = eventType.split(".").filter(Boolean)
    if (segments.length < 2) return capitalize(`${segments[0] ?? "unknown"} event`)

    const action = segments[segments.length - 1]
    const nouns = segments.slice(0, -1)
    const plural = PLURAL_ACTIONS.has(action)
    // Only the last noun takes the plural ("workflow revisions").
    const phrase = nouns.map((segment, i) => noun(segment, plural && i === nouns.length - 1))

    if (action === "logged") return `Viewed ${phrase.join(" ")} log`
    return `${capitalize(action.replace(/[_-]+/g, " "))} ${phrase.join(" ")}`
}

/** The resource heading an event type sits under, e.g. "Workflows" or "Test sets". */
export const eventTypeGroup = (eventType: string): string => {
    const resource = eventType.split(".")[0] ?? ""
    return capitalize(noun(resource, true))
}

/** Sort key for groups: known resources in `GROUP_ORDER`, then the rest alphabetically. */
export const eventTypeGroupRank = (eventType: string): number => {
    const index = GROUP_ORDER.indexOf(eventType.split(".")[0] ?? "")
    return index === -1 ? GROUP_ORDER.length : index
}
