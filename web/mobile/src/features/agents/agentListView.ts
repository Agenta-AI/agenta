import {timeAgo} from "@agenta/shared/utils"

/**
 * How the agents roster is CUT and NARROWED — the half of the view the filter menu owns, kept
 * out of the screen so the screen renders what these return rather than deriving it mid-render.
 * The same split `sessionListView.ts` makes next door.
 *
 * Every predicate here runs on rows this client already holds: the roster arrives whole (the
 * apps list is deliberately unpaged), so there is nothing to push to the server. `type` is the
 * exception — it picks WHICH roster the screen fetches, so by the time rows reach here they all
 * match it and a predicate for it would filter nothing.
 */

export type AgentGrouping = "none" | "owner" | "status" | "activity"

/** Which roster is on screen. One at a time: an agent is either in use or put away. */
export type AgentTypeFilter = "active" | "archived"

/**
 * The only state an agent has on this surface.
 *
 * Not the design's Active/Paused/Needs-attention — those belong to an automation, which has a
 * trigger to be paused. An agent is either holding a session that needs a person or it is not,
 * and that is the amber badge a row already paints.
 */
export type AgentStatusFilter = "all" | "waiting" | "idle"

/** `all` is every creator; anything else is a user id. */
export type AgentOwnerFilter = string

export interface AgentListView {
    owner: AgentOwnerFilter
    type: AgentTypeFilter
    status: AgentStatusFilter
    group: AgentGrouping
}

export const ALL_OWNERS = "all"

export const DEFAULT_AGENT_LIST_VIEW: AgentListView = {
    owner: ALL_OWNERS,
    type: "active",
    status: "all",
    group: "none",
}

/** The view control's dot: the filters only, never the grouping — cutting a list into runs
 * hides nothing, and a trigger dotted for that would cry wolf. */
export const isDefaultAgentFilters = (view: AgentListView): boolean =>
    view.owner === DEFAULT_AGENT_LIST_VIEW.owner &&
    view.type === DEFAULT_AGENT_LIST_VIEW.type &&
    view.status === DEFAULT_AGENT_LIST_VIEW.status

export const isDefaultAgentListView = (view: AgentListView): boolean =>
    isDefaultAgentFilters(view) && view.group === DEFAULT_AGENT_LIST_VIEW.group

/** What both views need of an agent, resolved once by the screen. */
export interface AgentListRow {
    id: string
    name: string
    description: string | null
    updatedAt: string | null
    /** The creator's display name, resolved once by the screen; empty when unknown. */
    ownerName: string
    createdById: string | null
    /** Sessions blocked on a person for this agent — the amber badge, and the Status facet. */
    waiting: number
}

export interface AgentListGroup {
    key: string
    label: string | null
    rows: AgentListRow[]
}

const DAY_MS = 86_400_000

/** The activity buckets the design names, in reading order. */
const ACTIVITY_BUCKETS = ["This week", "This month", "Older"] as const

const WAITING = "Waiting"
const IDLE = "Idle"
/** The status buckets, in the order they matter: what needs a person comes first. */
const STATUS_BUCKETS = [WAITING, IDLE] as const

/** A creator this client cannot name. A heading is read, not looked up — never the raw uuid. */
const UNKNOWN_OWNER = "Unknown"

const activityBucket = (updatedAt: string | null, now: number): string => {
    const at = updatedAt ? Date.parse(updatedAt) : NaN
    if (!Number.isFinite(at)) return "Older"
    const age = now - at
    if (age <= 7 * DAY_MS) return "This week"
    if (age <= 30 * DAY_MS) return "This month"
    return "Older"
}

/**
 * The heading a group is drawn under, per grouping. An empty order sorts alphabetically, which
 * is what creator headings want and what a bucket outside a fixed order falls back to.
 */
const GROUP_ORDER: Record<AgentGrouping, readonly string[]> = {
    none: [],
    owner: [],
    status: STATUS_BUCKETS,
    activity: ACTIVITY_BUCKETS,
}

/** What a row and a cell both say where an agent has never been described. */
export const NO_DESCRIPTION = "No description"

/** The roster's "Last active" cell. Empty rows read as an em dash, not as "just now". */
export const lastActiveLabel = (updatedAt: string | null): string =>
    updatedAt ? timeAgo(Date.parse(updatedAt)) : "—"

const matchesAgentOwner = (row: AgentListRow, owner: AgentOwnerFilter): boolean =>
    owner === ALL_OWNERS || row.createdById === owner

const matchesAgentStatus = (row: AgentListRow, status: AgentStatusFilter): boolean => {
    if (status === "waiting") return row.waiting > 0
    if (status === "idle") return row.waiting === 0
    return true
}

const groupLabel = (row: AgentListRow, group: AgentGrouping, now: number): string => {
    if (group === "owner") return row.ownerName || UNKNOWN_OWNER
    if (group === "status") return row.waiting > 0 ? WAITING : IDLE
    return activityBucket(row.updatedAt, now)
}

/** The filtered rows, cut into groups. */
export const deriveAgentList = (
    rows: AgentListRow[],
    view: AgentListView,
    now: number = Date.now(),
): AgentListGroup[] => {
    const kept = rows.filter(
        (row) => matchesAgentOwner(row, view.owner) && matchesAgentStatus(row, view.status),
    )

    if (view.group === "none") return [{key: "all", label: null, rows: kept}]

    const buckets = new Map<string, AgentListRow[]>()
    for (const row of kept) {
        const label = groupLabel(row, view.group, now)
        const existing = buckets.get(label)
        if (existing) existing.push(row)
        else buckets.set(label, [row])
    }

    const order = GROUP_ORDER[view.group]
    // A label the order does not name sorts after the ones it does, then alphabetically.
    const rank = (label: string) => {
        const index = order.indexOf(label)
        return index < 0 ? order.length : index
    }

    return [...buckets.keys()]
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((label) => ({key: label, label, rows: buckets.get(label) ?? []}))
}
