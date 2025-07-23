export const STATUS_LABELS: Record<string, string> = {
    // Backend evaluation codes
    EVALUATION_INITIALIZED: "Queued",
    EVALUATION_STARTED: "Running",
    EVALUATION_FINISHED: "Completed",
    EVALUATION_FINISHED_WITH_ERRORS: "Completed w/ Errors",
    EVALUATION_FAILED: "Failed",
    EVALUATION_AGGREGATION_FAILED: "Aggregation Failed",

    // Front-end/optimistic statuses
    annotating: "Annotating",
    revalidating: "Revalidating",
    running: "Running",
    success: "Success",
    failure: "Failure",
    cancelled: "Cancelled",
    pending: "Pending",
    incomplete: "Incomplete",
}

/**
 * Returns a user-friendly label for any status string.
 * Falls back to capitalising the first letter if unknown.
 */
export const getStatusLabel = (status: string): string => {
    return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1)
}
