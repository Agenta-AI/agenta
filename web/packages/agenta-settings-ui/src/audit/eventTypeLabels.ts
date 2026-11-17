/**
 * Human labels for dotted audit event types; the raw type stays the filter value. Known types and
 * resource groups read from the `settings.auditEventTypes` catalog. A type that catalog does not
 * list (a new one the API adds) is built from its words, in English.
 */
import type {CatalogKey} from "@agenta/i18n"
import type settingsAuditEventTypesCatalog from "@agenta/i18n/catalogs/settings.auditEventTypes"

type EventKey = CatalogKey<typeof settingsAuditEventTypesCatalog>
/** A `t` that holds the audit event type catalog. */
export type EventTypeT = (key: EventKey) => string

const key = (name: string) => `settings.auditEventTypes.${name}` as EventKey

/** Event type to catalog key. The type is the filter value, so it is never translated. */
const EVENT_KEYS: Record<string, EventKey> = Object.fromEntries(
    [
        ["unknown", "unknownEvent"],
        ["webhooks.subscriptions.tested", "webhooksSubscriptionsTested"],
        ["gateways.called", "gatewaysCalled"],
        ["agents.sharing.changed", "agentsSharingChanged"],
        ["sessions.sharing.changed", "sessionsSharingChanged"],
        ["organization_secrets.changed", "organizationSecretsChanged"],
        ["traces.fetched", "tracesFetched"],
        ["traces.queried", "tracesQueried"],
        ["testcases.fetched", "testcasesFetched"],
        ["testcases.queried", "testcasesQueried"],
        ...["queries", "testsets", "workflows", "environments"].flatMap((resource) =>
            ["retrieved", "fetched", "queried", "logged", "committed"].map((action) => [
                `${resource}.revisions.${action}`,
                `${resource}Revisions${action[0].toUpperCase()}${action.slice(1)}`,
            ]),
        ),
    ].map(([type, name]) => [type, key(name)]),
)

/** Resource (first segment) to the catalog key of its group heading. */
const GROUP_KEYS: Record<string, EventKey> = Object.fromEntries(
    [
        ["webhooks", "groupWebhooks"],
        ["gateways", "groupGateways"],
        ["agents", "groupAgents"],
        ["sessions", "groupSessions"],
        ["organization_secrets", "groupOrganizationSecrets"],
        ["traces", "groupTraces"],
        ["queries", "groupQueries"],
        ["testcases", "groupTestCases"],
        ["testsets", "groupTestSets"],
        ["workflows", "groupWorkflows"],
        ["environments", "groupEnvironments"],
        ["unknown", "groupUnknown"],
    ].map(([resource, name]) => [resource, key(name)]),
)

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
export const eventTypeLabel = (eventType: string, t: EventTypeT): string => {
    const known = Object.hasOwn(EVENT_KEYS, eventType) ? EVENT_KEYS[eventType] : undefined
    if (known) return t(known)
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
export const eventTypeGroup = (eventType: string, t: EventTypeT): string => {
    const resource = eventType.split(".")[0] ?? ""
    const known = Object.hasOwn(GROUP_KEYS, resource) ? GROUP_KEYS[resource] : undefined
    if (known) return t(known)
    return capitalize(noun(resource, true))
}

/** Sort key for groups: known resources in `GROUP_ORDER`, then the rest alphabetically. */
export const eventTypeGroupRank = (eventType: string): number => {
    const index = GROUP_ORDER.indexOf(eventType.split(".")[0] ?? "")
    return index === -1 ? GROUP_ORDER.length : index
}
