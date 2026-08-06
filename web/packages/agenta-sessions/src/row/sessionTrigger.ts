import type {SessionStream} from "@agenta/entities/session"

/**
 * Which automation started a session, read off the reserved tags the dispatcher stamps.
 *
 * Only the dispatcher knows this — nothing links a session back to a trigger afterwards — so
 * the row reads a snapshot taken when the run started, not a live join. A renamed automation
 * therefore keeps its old name on past runs.
 */
export const SESSION_ORIGIN_TAG = "ag.origin"
export const SESSION_TRIGGER_NAME_TAG = "ag.trigger.name"
export const SESSION_TRIGGER_KIND_TAG = "ag.trigger.kind"

const tag = (row: SessionStream, key: string): string | null => {
    const value = row.tags?.[key]
    return typeof value === "string" && value.trim() ? value.trim() : null
}

export function sessionTriggerName(row: SessionStream): string | null {
    return tag(row, SESSION_TRIGGER_NAME_TAG)
}

/** "schedule" (a cron fired) or "subscription" (an event arrived). */
export function sessionTriggerKind(row: SessionStream): string | null {
    return tag(row, SESSION_TRIGGER_KIND_TAG)
}

/**
 * Was this run started by an automation rather than by a person?
 *
 * `ag.origin` is the stamp the server filters on; the trigger name is a later addition, so a run
 * dispatched before it existed is still an automation and must group with them.
 */
export function isAutomationSession(row: SessionStream): boolean {
    return tag(row, SESSION_ORIGIN_TAG) === "trigger" || Boolean(sessionTriggerName(row))
}
