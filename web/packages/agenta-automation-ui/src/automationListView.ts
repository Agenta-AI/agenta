import {
    AUTOMATION_STATUS_LABEL,
    automationStatus,
    type Automation,
    type AutomationStatus,
} from "./automationModel"

/**
 * Filter, sort and group for the automations list — pure, so the screen renders what this returns
 * rather than deriving it inline.
 *
 * The three live together because they compose in one order and only one: narrow, then order,
 * then cut into runs. Splitting them across the screen's render would let a future sort silently
 * run before a filter, which is exactly the bug that produces a group header with nothing under
 * it.
 */

export type AutomationTypeFilter = "all" | "schedule" | "event"
/** `attention` is a run outcome (W6), so the filter offers only the two states a trigger has. */
export type AutomationStatusFilter = "all" | "working" | "paused"
export type AutomationSort = "updated" | "name"
export type AutomationGrouping = "none" | "type" | "status" | "agent"

export interface AutomationListView {
    type: AutomationTypeFilter
    status: AutomationStatusFilter
    /** An agent id, or `"all"`. */
    agent: string
    sort: AutomationSort
    group: AutomationGrouping
}

export const DEFAULT_AUTOMATION_LIST_VIEW: AutomationListView = {
    type: "all",
    status: "all",
    agent: "all",
    sort: "updated",
    group: "none",
}

export interface AutomationGroup {
    key: string
    /** `null` under `group: "none"` — the screen draws no header for it. */
    label: string | null
    automations: Automation[]
}

export const AUTOMATION_TYPE_LABEL: Record<"schedule" | "event", string> = {
    schedule: "Schedule",
    event: "Event",
}

/**
 * How many of the view's five controls are off their default — the number the menu's trigger
 * carries.
 *
 * Sort counts alongside the filters even though it hides nothing: the trigger's job is to say the
 * table is not showing what it shows by default, and a re-sorted table is exactly that.
 */
export const automationListViewChanges = (view: AutomationListView): number =>
    (Object.keys(DEFAULT_AUTOMATION_LIST_VIEW) as (keyof AutomationListView)[]).filter(
        (key) => view[key] !== DEFAULT_AUTOMATION_LIST_VIEW[key],
    ).length

export const isDefaultAutomationListView = (view: AutomationListView): boolean =>
    automationListViewChanges(view) === 0

/** The same call the table's Status column makes, so a filter and a row can never disagree. */
const rowStatus = (automation: Automation): AutomationStatus => automationStatus(automation, false)

const matches = (automation: Automation, view: AutomationListView): boolean => {
    if (view.type !== "all" && automation.kind !== view.type) return false
    if (view.status !== "all" && rowStatus(automation) !== view.status) return false
    if (view.agent !== "all" && (automation.agentId ?? "") !== view.agent) return false
    return true
}

const compare = (a: Automation, b: Automation, sort: AutomationSort): number => {
    if (sort === "name") return a.name.localeCompare(b.name, undefined, {sensitivity: "base"})
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
}

const groupOf = (
    automation: Automation,
    grouping: AutomationGrouping,
    agentNames: Map<string, string>,
): {key: string; label: string} => {
    switch (grouping) {
        case "type":
            return {key: automation.kind, label: AUTOMATION_TYPE_LABEL[automation.kind]}
        case "status": {
            const status = rowStatus(automation)
            return {key: status, label: AUTOMATION_STATUS_LABEL[status]}
        }
        case "agent": {
            const id = automation.agentId ?? ""
            const name = agentNames.get(id)?.trim()
            return {key: id || "__unbound__", label: name || (id ? "Unknown agent" : "No agent")}
        }
        default:
            return {key: "__all__", label: ""}
    }
}

/**
 * The rows the table should draw, already narrowed, ordered, and cut into groups.
 *
 * Groups keep first-appearance order rather than being re-sorted by label: the reader chose the
 * sort, and re-ordering the groups underneath it would put "Working" above "Paused" on a
 * name-sorted list for no reason a reader could name.
 */
export function deriveAutomationList(
    automations: Automation[],
    view: AutomationListView,
    agentNames = new Map<string, string>(),
): AutomationGroup[] {
    const rows = automations.filter((automation) => matches(automation, view))
    rows.sort((a, b) => compare(a, b, view.sort))

    if (view.group === "none") {
        return rows.length ? [{key: "__all__", label: null, automations: rows}] : []
    }

    const groups = new Map<string, AutomationGroup>()
    for (const automation of rows) {
        const {key, label} = groupOf(automation, view.group, agentNames)
        const existing = groups.get(key)
        if (existing) existing.automations.push(automation)
        else groups.set(key, {key, label, automations: [automation]})
    }
    return [...groups.values()]
}
