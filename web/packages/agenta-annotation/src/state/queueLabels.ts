/**
 * Labels and tones for annotation queues and their scenarios.
 *
 * Plain data and pure functions with no UI library, so the antd views and the /m views read the
 * same words.
 */

export const QUEUE_KIND_LABELS: Record<string, string> = {
    traces: "Traces",
    testcases: "Test cases",
    testsets: "Test set",
    queries: "Queries",
}

export const QUEUE_STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    running: "Running",
    success: "Completed",
    failure: "Failed",
    errors: "Errors",
    cancelled: "Cancelled",
}

/** Scenario status labels. A scenario that succeeded reads "Success"; a queue reads "Completed". */
export const SCENARIO_STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    running: "Running",
    success: "Success",
    failure: "Failed",
    errors: "Errors",
    cancelled: "Cancelled",
}

export type StatusTone = "default" | "processing" | "success" | "error" | "warning"

const QUEUE_STATUS_TONES: Record<string, StatusTone> = {
    pending: "default",
    queued: "processing",
    running: "processing",
    success: "success",
    failure: "error",
    errors: "error",
    cancelled: "warning",
}

const SCENARIO_STATUS_TONES: Record<string, StatusTone> = {
    pending: "warning",
    queued: "warning",
    running: "processing",
    success: "success",
    failure: "error",
    errors: "error",
    cancelled: "warning",
}

const QUEUE_KIND_TONES: Record<string, string> = {
    traces: "blue",
    testcases: "green",
    testsets: "purple",
    queries: "orange",
}

const statusKey = (status: string | null | undefined) => (status ?? "pending").toLowerCase()

const titleCase = (key: string) => key.charAt(0).toUpperCase() + key.slice(1)

/** The queue status as the user reads it. An unknown status is shown title-cased, not hidden. */
export function queueStatusLabel(status: string | null | undefined): string {
    const key = statusKey(status)
    return QUEUE_STATUS_LABELS[key] ?? titleCase(key)
}

export function queueStatusTone(status: string | null | undefined): StatusTone {
    return QUEUE_STATUS_TONES[statusKey(status)] ?? "default"
}

export function queueKindLabel(kind: string | null | undefined): string {
    return kind ? (QUEUE_KIND_LABELS[kind] ?? "") : ""
}

export function queueKindTone(kind: string | null | undefined): string {
    return kind ? (QUEUE_KIND_TONES[kind] ?? "default") : "default"
}

/** The scenario status as the user reads it. The status values are the API enum, so a failed scenario reads "Failed". */
export function scenarioStatusLabel(status: string | null | undefined): string {
    const key = statusKey(status)
    return SCENARIO_STATUS_LABELS[key] ?? titleCase(key)
}

export function scenarioStatusTone(status: string | null | undefined): StatusTone {
    return SCENARIO_STATUS_TONES[statusKey(status)] ?? "warning"
}

/** "X out of Y" for a queue's review progress, "No items" for an empty queue, "" while unknown. */
export function formatQueueReviewed(
    progress: {completed: number; total: number} | null | undefined,
): string {
    if (!progress) return ""
    if (progress.total === 0) return "No items"
    return `${progress.completed} out of ${progress.total}`
}

/** Shortens a long scenario id to its first and last five characters. */
export function truncateScenarioId(id: string): string {
    if (id.length <= 14) return id
    return `${id.slice(0, 5)}...${id.slice(-5)}`
}
