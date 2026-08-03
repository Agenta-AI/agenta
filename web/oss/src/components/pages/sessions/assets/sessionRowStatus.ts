import {deriveStreamNest, type SessionStream} from "@agenta/entities/session"

/**
 * What a row's status dot says. Ordered by urgency, and the first match wins: a session that is
 * both running and gated is *waiting* — the gate is what the user has to act on.
 */
export type SessionRowStatus = "waiting" | "running" | "alive" | "ended" | "archived" | "idle"

export interface SessionRowStatusMeta {
    status: SessionRowStatus
    label: string
    /** antd semantic token class for the dot. */
    dotClassName: string
    /** Only `waiting` and `running` justify a pulse; a warm sandbox is not activity. */
    pulse: boolean
}

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
    const status = resolve(row, pendingCount)
    return {status, ...META[status]}
}

function resolve(row: SessionStream, pendingCount: number | undefined): SessionRowStatus {
    // A gate outlives the run that raised it: the turn can finish while the request stays pending,
    // so this is checked before liveness, not after.
    if ((pendingCount ?? 0) > 0) return "waiting"

    const nest = deriveStreamNest(row)
    if (nest.isRunning) return "running"
    if (nest.isAlive) return "alive"

    // Archive is a display state; ended is a real terminal one. A row can be both, and archived
    // is what the user chose, so it wins.
    if (row.archived_at) return "archived"
    if (row.deleted_at) return "ended"
    return "idle"
}
