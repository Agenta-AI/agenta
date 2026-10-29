import type {SessionRunStatus} from "@agenta/chat/model"

/** What the favicon says while the tab is hidden; `null` is the plain icon. */
export type TabRunBadge = "running" | "awaiting" | "completed" | "error" | null

/** Non-idle run state per session id; idle is absence. */
export type SessionStatuses = Readonly<Record<string, SessionRunStatus>>

export interface TabRunBadgeState {
    hidden: boolean
    statuses: SessionStatuses
    /** How runs that were active while hidden ended, held until the user looks at the tab. */
    settled: "completed" | "error" | null
}

export type TabRunBadgeEvent =
    | {type: "visibility"; hidden: boolean}
    | {type: "status"; statuses: SessionStatuses}

const isActive = (status: SessionRunStatus | undefined) =>
    status === "running" || status === "awaiting"

const settledBetween = (
    prev: SessionStatuses,
    next: SessionStatuses,
    held: TabRunBadgeState["settled"],
): TabRunBadgeState["settled"] => {
    let settled = held
    for (const [id, status] of Object.entries(prev)) {
        if (!isActive(status) || isActive(next[id])) continue
        if (next[id] === "error") return "error"
        settled ??= "completed"
    }
    return settled
}

export const reduceTabRunBadge = (
    state: TabRunBadgeState,
    event: TabRunBadgeEvent,
): TabRunBadgeState => {
    if (event.type === "visibility") {
        return {hidden: event.hidden, statuses: state.statuses, settled: null}
    }
    return {
        hidden: state.hidden,
        statuses: event.statuses,
        settled: state.hidden
            ? settledBetween(state.statuses, event.statuses, state.settled)
            : null,
    }
}

export const tabRunBadge = ({hidden, statuses, settled}: TabRunBadgeState): TabRunBadge => {
    if (!hidden) return null
    const live = Object.values(statuses)
    if (live.includes("awaiting")) return "awaiting"
    if (live.includes("running")) return "running"
    return settled
}
