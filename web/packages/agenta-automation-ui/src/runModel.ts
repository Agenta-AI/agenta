import type {TriggerDelivery} from "@agenta/entities/gatewayTrigger"

import {deliveryOutcome, type Automation} from "./automationModel"

/**
 * What a delivery row means, in the words the run history speaks.
 *
 * Pure, like `automationModel` — the run screen reads a delivery through these and never
 * branches on the raw payload, so the row, the pane header and the empty state can never
 * disagree about what a run was called or whether it produced anything.
 */

/** The window the run-history caption counts over, and the only one this screen claims. */
export const RUN_WINDOW_DAYS = 30

/** Newest first — the order every surface here reads deliveries in. */
export function sortRuns(deliveries: TriggerDelivery[]): TriggerDelivery[] {
    return [...deliveries].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
}

/** How many of these ran inside the caption's window. */
export function countRecentRuns(deliveries: TriggerDelivery[], now = Date.now()): number {
    const cutoff = now - RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000
    return deliveries.filter((delivery) => {
        const at = Date.parse(delivery.created_at ?? "")
        return Number.isFinite(at) && at >= cutoff
    }).length
}

/** "12 runs in the last 30 days" — the caption under both the card and the heading. */
export function runCountCaption(count: number): string {
    return `${count} ${count === 1 ? "run" : "runs"} in the last ${RUN_WINDOW_DAYS} days`
}

/** One day's worth of runs, in the shape the list renders. */
export interface RunDayGroup {
    /** Stable local-calendar key ("2026-09-08"), and the list's React key. */
    key: string
    /** Uppercase day heading — "TODAY", "YESTERDAY", "FRI", "27 AUG". */
    label: string
    runs: TriggerDelivery[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight — runs group by calendar day, not by rolling 24h buckets. */
function startOfDay(ms: number): number {
    const date = new Date(ms)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
}

function dayKey(ms: number): string {
    const date = new Date(ms)
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${date.getFullYear()}-${month}-${day}`
}

/**
 * What day a run happened, in the reader's terms.
 *
 * Title case here; the group heading upper-cases it. Inside the last week the weekday alone is
 * unambiguous, so it says "Fri" rather than a date the reader has to decode back into one.
 */
function dayLabel(ms: number, now: number): string {
    const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS)
    if (days <= 0) return "Today"
    if (days === 1) return "Yesterday"
    const date = new Date(ms)
    if (days < 7) return date.toLocaleDateString(undefined, {weekday: "short"})
    return `${date.getDate()} ${date.toLocaleDateString(undefined, {month: "short"})}`
}

/**
 * "08:00" — the stamp a row carries.
 *
 * Not a relative age: the day heading above the row has already said which day, so repeating
 * "12d ago" on every row would restate the heading and lose the only fact it was missing.
 * `h23` is pinned because `hour12: false` alone still prints midnight as "24:00" on some ICUs.
 */
export function runTimeOfDay(delivery: TriggerDelivery): string {
    const at = Date.parse(delivery.created_at ?? "")
    if (!Number.isFinite(at)) return ""
    return new Date(at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    })
}

/** "Today 08:00" / "Fri 16:12" — the pane header, in the list's day-and-time vocabulary. */
export function runWhenLabel(delivery: TriggerDelivery, now = Date.now()): string {
    const at = Date.parse(delivery.created_at ?? "")
    if (!Number.isFinite(at)) return ""
    return `${dayLabel(at, now)} ${runTimeOfDay(delivery)}`.trim()
}

/**
 * The runs bucketed by the day they ran on — the list's DEFAULT shape, not an optional filter.
 *
 * Newest group first and newest run inside it, off `sortRuns`, so the order is the one every
 * other surface here reads. A row whose timestamp will not parse cannot claim a day, so it
 * falls into a trailing "EARLIER" group rather than being dropped or dated wrongly.
 */
export function runDayGroups(deliveries: TriggerDelivery[], now = Date.now()): RunDayGroup[] {
    const groups: RunDayGroup[] = []
    for (const delivery of sortRuns(deliveries)) {
        const at = Date.parse(delivery.created_at ?? "")
        const dated = Number.isFinite(at)
        const key = dated ? dayKey(at) : "unknown"
        const last = groups[groups.length - 1]
        if (last?.key === key) {
            last.runs.push(delivery)
            continue
        }
        groups.push({
            key,
            label: dated ? dayLabel(at, now).toUpperCase() : "EARLIER",
            runs: [delivery],
        })
    }
    return groups
}

/**
 * What to call one run.
 *
 * A capture-only test delivery says so first: it never invoked, so calling it by its event
 * would promise a conversation that does not exist. Otherwise a schedule run is simply
 * scheduled — its cron is the automation's, not this row's — and an event run is named by the
 * event that arrived.
 */
export function runLabel(delivery: TriggerDelivery): string {
    if (delivery.data?.is_test) return "Test run"
    if (delivery.schedule_id) return "Scheduled run"
    const event = readableEventKey(delivery.data?.event_key ?? "")
    return event || "Run"
}

/** "GITHUB_STAR_ADDED_EVENT" → "Github star added". The trailing "EVENT" adds nothing. */
export function readableEventKey(eventKey: string): string {
    const words = eventKey
        .trim()
        .split(/[_\s./-]+/)
        .filter(Boolean)
        .map((part) => part.toLowerCase())
    if (words.length > 1 && words[words.length - 1] === "event") words.pop()
    if (!words.length) return ""
    const sentence = words.join(" ")
    return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Dot colour, from `deliveryOutcome` — never `status.type`, which the backend never sets. */
export function runDotClass(delivery: TriggerDelivery): string {
    switch (deliveryOutcome(delivery)) {
        case "ok":
            return "bg-success"
        case "bad":
            return "bg-destructive"
        default:
            return "bg-muted-foreground/50"
    }
}

/** Spoken form of the same thing, for the readers a colour does not reach. */
export function runOutcomeLabel(delivery: TriggerDelivery): string {
    switch (deliveryOutcome(delivery)) {
        case "ok":
            return "Succeeded"
        case "bad":
            return "Failed"
        default:
            return "Pending"
    }
}

/**
 * How long a run took.
 *
 * DERIVED, not reported: a delivery carries no duration field, so this is the distance between
 * the row being written (`created_at`) and last touched (`updated_at`) — which is the dispatch
 * settling, and the closest thing to a run length the payload has. A row never updated after
 * insert has the two equal, and "took 0s" would be a measurement rather than the absence of
 * one, so that case returns null and the caller drops the clause.
 */
export function runDuration(delivery: TriggerDelivery): string | null {
    const started = Date.parse(delivery.created_at ?? "")
    const ended = Date.parse(delivery.updated_at ?? "")
    if (!Number.isFinite(started) || !Number.isFinite(ended)) return null
    const ms = ended - started
    if (ms <= 0) return null

    const seconds = Math.round(ms / 1000)
    if (seconds < 1) return null
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
        const rest = seconds % 60
        return rest ? `${minutes}m ${rest}s` : `${minutes}m`
    }
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * Whether this run has a conversation to show.
 *
 * Three ways it does not, and all three are ordinary: a capture-only test delivery never
 * invokes; a delivery that failed before invoking (the dispatcher writes `400` on the rejected
 * request) never got as far as a session; and a row written before the dispatcher stamped
 * `session_id` has nothing to point at. Mounting the conversation on any of them would open a
 * transcript that can only ever spin.
 */
export function runSessionId(delivery: TriggerDelivery): string | null {
    if (delivery.data?.is_test) return null
    if (String(delivery.status?.code ?? "") === "400") return null
    return delivery.data?.session_id || null
}

/** Why a run has no conversation, when the delivery says. */
export function runError(delivery: TriggerDelivery): string | null {
    return delivery.data?.error || delivery.status?.stacktrace || null
}

/** The owner filter `useTriggerDeliveries` takes, in this app's vocabulary. */
export function deliveriesOwner(automation: Automation | null) {
    if (!automation?.id) return undefined
    return {
        kind: automation.kind === "schedule" ? ("schedule" as const) : ("subscription" as const),
        id: automation.id,
    }
}
