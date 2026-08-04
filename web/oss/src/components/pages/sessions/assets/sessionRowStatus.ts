import {
    deriveSessionRowStatus,
    type SessionRowStatus,
    type SessionStream,
} from "@agenta/entities/session"

export type {SessionRowStatus}

export interface SessionRowStatusMeta {
    status: SessionRowStatus
    label: string
    /** antd semantic token class for the dot. */
    dotClassName: string
    /** Only `waiting` and `running` justify a pulse; a warm sandbox is not activity. */
    pulse: boolean
    /** Text shown inline on the row. Set only where a colour alone would under-report the state. */
    chipLabel?: string
    chipClassName?: string
}

/** Presentation for each status. The status itself is derived in `@agenta/entities/session`, so
 * every surface that lists sessions agrees on what a row IS; only the styling lives here. */
const META: Record<SessionRowStatus, Omit<SessionRowStatusMeta, "status">> = {
    // A blocked session is the only row that costs you something to miss, so it is the only one
    // that gets words — a 8px dot is not a call to action.
    waiting: {
        label: "Waiting on you",
        dotClassName: "bg-colorWarning",
        pulse: true,
        chipLabel: "Waiting",
        chipClassName: "bg-colorWarningBg text-colorWarningText",
    },
    running: {label: "Running", dotClassName: "bg-colorSuccess", pulse: true},
    alive: {label: "Ready to resume", dotClassName: "bg-colorInfoBorder", pulse: false},
    ended: {label: "Ended", dotClassName: "bg-colorTextQuaternary", pulse: false},
    archived: {label: "Archived", dotClassName: "bg-colorTextQuaternary", pulse: false},
    idle: {label: "Idle", dotClassName: "bg-colorBorder", pulse: false},
}

export function sessionRowStatus(
    row: SessionStream,
    pendingCount: number | undefined,
): SessionRowStatusMeta {
    const status = deriveSessionRowStatus(row, pendingCount)
    return {status, ...META[status]}
}

/**
 * What a blocked session is actually asking for. The gate poll already carries `kind` and the row
 * used to throw it away, so a waiting row said only that it was stuck — never whether it wanted a
 * decision, a message, or a tool run.
 *
 * Nouns, never imperatives. "Approve" in a chip is a button, and this one does nothing: the row
 * opens the session, where the gate is already docked above the composer. Approving from a list
 * would mean approving an action you haven't read, so the label names the state and leaves the
 * decision on the surface that shows what is being decided.
 */
export function pendingGateLabel(kinds: string[] | undefined): string {
    if (!kinds?.length) return "Waiting"
    if (kinds.length > 1) return "Multiple"
    switch (kinds[0]) {
        case "user_approval":
            return "Approval"
        case "user_input":
            return "Input"
        case "client_tool":
            return "Tool call"
        default:
            return "Waiting"
    }
}
