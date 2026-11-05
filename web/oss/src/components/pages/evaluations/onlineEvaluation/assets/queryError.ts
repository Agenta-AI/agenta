export const TRACE_FILTERS_NOT_SAVED_MESSAGE =
    "Couldn't save the trace filters. Check the filters and try again."

export const CREATE_FAILED_MESSAGE = "Failed to create online evaluation"

/**
 * The message the drawer shows when the query cannot be created. The queries endpoint answers
 * 400 or 422 with a detail when it refuses a filter; that detail names fields by their code
 * names, so the user gets plain text. Any other failure (network, permission, server) gets the
 * drawer's generic create-failure text.
 */
export const queryCreateErrorMessage = (error: unknown): string => {
    const response = (error as {response?: {status?: number; data?: {detail?: unknown}}})?.response
    const status = response?.status
    const detail = response?.data?.detail
    const hasDetail = Array.isArray(detail) ? detail.length > 0 : Boolean(detail)
    return (status === 400 || status === 422) && hasDetail
        ? TRACE_FILTERS_NOT_SAVED_MESSAGE
        : CREATE_FAILED_MESSAGE
}
