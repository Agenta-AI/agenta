import {
    cronToBuilder,
    describeCron,
    isEntityActive,
    summarizeSchedule,
    triggerBoundAgentId,
    type TriggerDelivery,
    type TriggerSchedule,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"

/**
 * The one adapter between the two trigger entities and the single thing this app calls an
 * automation.
 *
 * A cron schedule and an event subscription are different rows on different endpoints, but a
 * reader sees one list of things that run an agent. Every screen here reads {@link Automation}
 * instead of branching on which entity it came from; `raw` keeps the source row for the edit
 * and start/stop calls, which stay per-kind.
 *
 * Pure by design — no React, no hooks — so the mapping is testable and the hooks stay thin.
 */

export type AutomationKind = "schedule" | "event"

export type AutomationStatus = "working" | "paused" | "attention"

export interface Automation {
    id: string
    kind: AutomationKind
    name: string
    description: string
    /** The agent it runs, or null when the trigger is unbound. */
    agentId: string | null
    isActive: boolean
    /** Schedules only — the 5-field UTC cron expression. */
    cron: string | null
    /** Event subscriptions only — the provider event key ("GITHUB_STAR_ADDED_EVENT"). */
    eventKey: string | null
    /** Event subscriptions only — the connection the event arrives on. */
    connectionId: string | null
    updatedAt: string | null
    raw: TriggerSchedule | TriggerSubscription
}

export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
    working: "Working",
    paused: "Paused",
    attention: "Needs attention",
}

export function toAutomation(
    entity: TriggerSchedule | TriggerSubscription,
    kind: AutomationKind,
): Automation {
    // The two rows share every header field; only `data` and `connection_id` differ, so each
    // kind is read through its own narrowed view rather than a union field-by-field.
    const schedule = kind === "schedule" ? (entity as TriggerSchedule) : null
    const subscription = kind === "event" ? (entity as TriggerSubscription) : null

    return {
        id: entity.id ?? "",
        kind,
        // An unnamed trigger reads as its slug before it reads as nothing; neither ever falls
        // through to the raw id.
        name: entity.name || entity.slug || "Untitled automation",
        description: entity.description ?? "",
        agentId: triggerBoundAgentId(entity.data?.references),
        isActive: isEntityActive(entity),
        cron: schedule?.data?.schedule ?? null,
        eventKey: subscription?.data?.event_key ?? null,
        connectionId: subscription?.connection_id ?? null,
        updatedAt: entity.updated_at ?? entity.created_at ?? null,
        raw: entity,
    }
}

/**
 * The stored `data.inputs_fields` as an object.
 *
 * The schema allows a bare selector STRING there ("$" = the whole event context), which no editor
 * on this surface can represent — reading one as an object would silently replace it, so it reads
 * as empty and the composer's own warning is what stands between it and an overwrite.
 */
export function automationInputsFields(automation: Automation): Record<string, unknown> {
    const stored = automation.raw.data?.inputs_fields
    return stored && typeof stored === "object" && !Array.isArray(stored)
        ? (stored as Record<string, unknown>)
        : {}
}

/**
 * What the row's status pill says.
 *
 * Stopped is a choice, so it never reads as a problem. Only an automation that is supposed to be
 * running and just failed earns attention — the caller decides what "recent" means, because the
 * delivery window it looks at belongs to the screen, not to the trigger.
 */
export function automationStatus(a: Automation, hasRecentFailure: boolean): AutomationStatus {
    if (!a.isActive) return "paused"
    return hasRecentFailure ? "attention" : "working"
}

/**
 * "Weekdays at 09:00 UTC", or "When star added in Github" — never a cron expression.
 *
 * Schedules go through the same `cronToBuilder` → `summarizeSchedule` pair the detail screen's
 * `ScheduleBuilderField` renders in its collapsed row, so a row and the automation it opens never
 * describe the same cron two different ways. An expression the builder can't represent keeps
 * `describeCron`'s longhand.
 */
export function runsWhenLabel(a: Automation): string {
    if (a.kind !== "schedule") return eventPhrase(a.eventKey ?? "")

    const cron = a.cron ?? ""
    const {state, representable} = cronToBuilder(cron)
    return representable ? summarizeSchedule(state) : describeCron(cron)
}

/**
 * The name an unnamed automation gets: "Mon at 09:00 UTC — Teach me".
 *
 * The two facts a reader needs to tell one row from another are when it runs and which agent it
 * runs, and both are already chosen by the time this is asked for — so a name can be built rather
 * than demanded. Without an agent there is nothing to build from and the generic name stands.
 */
export function generatedAutomationName(a: Automation, agentName: string | null): string {
    const runsWhen = runsWhenLabel(a).trim()
    const agent = (agentName ?? "").trim()
    if (!agent || !runsWhen) return "Untitled automation"
    return `${runsWhen} — ${agent}`
}

/**
 * Whether a delivery worked.
 *
 * Reads `status.message`, which is where the backend writes "success" / "failed" / "dispatched".
 * `status.type` is never set, so the shared `deliveryStatusColor` in `@agenta/entity-ui` returns
 * neutral for every row — do not reach for it here.
 */
export function deliveryOutcome(delivery: TriggerDelivery): "ok" | "bad" | "pending" {
    switch ((delivery.status?.message ?? "").toLowerCase()) {
        case "success":
            return "ok"
        case "failed":
            return "bad"
        default:
            return "pending"
    }
}

/**
 * What to call the agent this automation runs.
 *
 * A binding whose id is not in the agent roster is still a binding — the agent may be archived, or
 * live outside this roster. Calling that "no agent" would both misreport the automation and invite
 * a rebind that quietly replaces something real, so unresolved and unbound stay distinct.
 */
export function agentLabel(
    agentId: string | null,
    resolvedName: string | null,
    rosterReady = true,
): string | null {
    if (resolvedName) return resolvedName
    // A roster that has not answered yet cannot say a binding is unresolvable — calling it
    // unknown mid-load makes a perfectly good agent flash as broken before its name arrives.
    if (!rosterReady) return null
    return agentId ? "Unknown agent" : null
}

/** "GITHUB_STAR_ADDED_EVENT" → "When star added in Github". The first segment is the app. */
function eventPhrase(eventKey: string): string {
    const parts = eventKey
        .trim()
        .split(/[_\s./-]+/)
        .filter(Boolean)
    if (!parts.length) return "When its event arrives"

    // Composio keys carry a trailing "EVENT" that adds nothing to the sentence.
    const words = parts.map((part) => part.toLowerCase())
    if (words.length > 1 && words[words.length - 1] === "event") words.pop()

    const [app, ...rest] = words
    if (!rest.length) return `When ${capitalize(app)}`
    return `When ${rest.join(" ")} in ${capitalize(app)}`
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1)
}
