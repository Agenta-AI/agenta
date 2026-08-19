import {deriveStreamNest} from "./liveness"
import type {SessionStream} from "./schema"

/**
 * What a session row's status indicator means. Ordered by urgency, first match wins: a session
 * that is both running and gated is *waiting*, because the gate is the part a human must act on.
 */
export type SessionRowStatus = "waiting" | "running" | "alive" | "ended" | "archived" | "idle"

/**
 * One definition of a session's list status, shared by every surface that lists sessions.
 *
 * `pendingCount` comes from the project-wide actionable-interactions query; pass `undefined` while
 * it is unresolved, which reads the same as zero here but lets callers hold off on a "waiting"
 * filter until they actually know.
 */
export function deriveSessionRowStatus(
    row: SessionStream,
    pendingCount: number | undefined,
): SessionRowStatus {
    // A gate outlives the run that raised it — the turn can finish while the request stays
    // pending — so this is checked before liveness, not after.
    if ((pendingCount ?? 0) > 0) return "waiting"

    const nest = deriveStreamNest(row)
    if (nest.isRunning) return "running"
    if (nest.isAlive) return "alive"

    // A row can be both archived and ended. Archived is the state the user chose, so it wins.
    if (row.archived_at) return "archived"
    if (row.deleted_at) return "ended"
    return "idle"
}
