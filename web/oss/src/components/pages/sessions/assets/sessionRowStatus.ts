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
}

/** Presentation for each status. The status itself is derived in `@agenta/entities/session`, so
 * every surface that lists sessions agrees on what a row IS; only the styling lives here. */
const META: Record<SessionRowStatus, Omit<SessionRowStatusMeta, "status">> = {
    waiting: {label: "Waiting on you", dotClassName: "bg-colorWarning", pulse: true},
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
