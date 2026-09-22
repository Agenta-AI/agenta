import type {SessionRowVm} from "@agenta/sessions/row"

/**
 * How the sessions list is CUT — the one half of the view the filter menu owns that is not a
 * server predicate.
 *
 * Filtering lives in the shared atoms (`@agenta/sessions/state`), because every surface that
 * lists sessions narrows the same set on the server. Grouping does not: it re-arranges rows this
 * client already has, so it is a display preference and it lives here.
 *
 * Pure, so the screen renders what this returns rather than deriving it mid-render — the same
 * split `automationListView.ts` makes next door, for the same reason.
 */

export type SessionGrouping = "agent" | "date" | "status" | "none"

/** Last-activity floor, matching the sidebar's own facet. */
export type SessionActivityWindow = "all" | "24h" | "7d" | "30d"

const ACTIVITY_WINDOW_HOURS: Record<SessionActivityWindow, number | null> = {
    all: null,
    "24h": 24,
    "7d": 24 * 7,
    "30d": 24 * 30,
}

export interface SessionListView {
    group: SessionGrouping
    activity: SessionActivityWindow
}

/**
 * Agent, not date. A reader scanning this list is looking for the thing they were talking to;
 * the Updated column already carries recency, and the server orders by it, so grouping by date
 * only restates the column beside it.
 *
 * Seven days, the same default the sidebar takes: a session list is a list of what you are
 * working on, and everything ever started is an archive with a different purpose.
 */
export const DEFAULT_SESSION_LIST_VIEW: SessionListView = {group: "agent", activity: "7d"}

export const isDefaultSessionListView = (view: SessionListView): boolean =>
    view.group === DEFAULT_SESSION_LIST_VIEW.group &&
    view.activity === DEFAULT_SESSION_LIST_VIEW.activity

/**
 * The window as an ISO instant the server can compare against, or `undefined` for no bound.
 *
 * Rounded down to the hour so the value is stable between renders — a floor recomputed from
 * `Date.now()` on every render would mint a new query key each time and refetch the list forever.
 */
export const activityFloorIso = (
    activity: SessionActivityWindow,
    now: number = Date.now(),
): string | undefined => {
    const hours = ACTIVITY_WINDOW_HOURS[activity]
    if (!hours) return undefined
    const HOUR_MS = 3_600_000
    return new Date(Math.floor(now / HOUR_MS) * HOUR_MS - hours * HOUR_MS).toISOString()
}

export interface SessionListGroup {
    key: string
    /** `null` under `group: "none"` — the table draws no heading at all. */
    label: string | null
    rows: SessionRowVm[]
}

/**
 * Date and status have an order a reader expects; agent does not, so its groups keep
 * first-appearance order, which under the server's recency sort puts the agent you used last
 * first.
 */
const DATE_ORDER: readonly string[] = ["today", "yesterday", "week", "older"]
const STATUS_ORDER: readonly string[] = ["waiting", "running", "alive", "idle", "ended", "archived"]

/** Local midnight, so "yesterday" means the calendar day and not "26 hours ago". */
const startOfDay = (ms: number): number => {
    const date = new Date(ms)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
}

const DAY_MS = 86_400_000

const dateBucket = (activityAt: string | null, now: number): {key: string; label: string} => {
    const parsed = activityAt ? Date.parse(activityAt) : Number.NaN
    // A row with no activity timestamp is the oldest thing on the list, not a bucket of its own:
    // one heading over one row says nothing a reader can use.
    if (Number.isNaN(parsed)) return {key: "older", label: "Older"}
    const days = Math.floor((startOfDay(now) - startOfDay(parsed)) / DAY_MS)
    if (days <= 0) return {key: "today", label: "Today"}
    if (days === 1) return {key: "yesterday", label: "Yesterday"}
    if (days < 7) return {key: "week", label: "This week"}
    return {key: "older", label: "Older"}
}

const groupOf = (
    row: SessionRowVm,
    grouping: Exclude<SessionGrouping, "none">,
    agentNames: Map<string, string>,
    now: number,
): {key: string; label: string} => {
    if (grouping === "date") return dateBucket(row.activityAt, now)
    // The row's own status meta, so a heading and the dot beside the title can never disagree.
    if (grouping === "status") return {key: row.status.status, label: row.status.label}
    const id = row.agentId ?? ""
    const name = agentNames.get(id)?.trim()
    // "No agent yet" is a session with no turns; "Unknown agent" is one whose agent the roster
    // this client holds does not name. Different facts, so different headings.
    return {key: id || "__unbound__", label: name || (id ? "Unknown agent" : "No agent yet")}
}

/**
 * The rows cut into runs under headings.
 *
 * Narrowing and ordering are NOT here: every session filter is a server predicate and the server
 * orders by recency, so this only re-arranges what has already arrived. That also means a group
 * grows as the reader pages — the same bargain the automations list makes.
 *
 * `now` is a parameter rather than a `Date.now()` call so the date buckets can be tested.
 */
export function deriveSessionGroups(
    rows: SessionRowVm[],
    grouping: SessionGrouping,
    agentNames = new Map<string, string>(),
    now: number = Date.now(),
): SessionListGroup[] {
    if (grouping === "none") return rows.length ? [{key: "all", label: null, rows}] : []

    const groups = new Map<string, SessionListGroup>()
    for (const row of rows) {
        const {key, label} = groupOf(row, grouping, agentNames, now)
        const existing = groups.get(key)
        if (existing) existing.rows.push(row)
        else groups.set(key, {key, label, rows: [row]})
    }

    const ordered = [...groups.values()]
    const order = grouping === "date" ? DATE_ORDER : grouping === "status" ? STATUS_ORDER : null
    if (!order) return ordered
    return ordered.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}
