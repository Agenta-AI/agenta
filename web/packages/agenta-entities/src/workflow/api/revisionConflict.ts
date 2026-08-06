/**
 * Parses the `revision_conflict` 409 raised by `POST /workflows/revisions/commit` when a
 * commit's `base_revision_id` no longer matches the variant's head (see `RevisionConflictError`
 * in `api/oss/src/core/workflows/service.py`).
 *
 * The canonical envelope is `{detail: {code, message, retryable, next_step, details: {
 * base_revision_id, current_revision_id, current_revision_version? }}}` (FastAPI's default
 * `HTTPException(detail=...)` wrapping). An in-flight API error-envelope migration is
 * flattening this shape, so parsing here is defensive: it also accepts `code`/`details` sitting
 * directly on `detail` as a string, or on the response body's top level.
 */

export interface WorkflowRevisionConflictInfo {
    baseRevisionId?: string
    currentRevisionId?: string
    currentRevisionVersion?: string
}

const REVISION_CONFLICT_CODE = "revision_conflict"

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined
}

/**
 * Returns the conflict details when `error` is a `revision_conflict` 409, otherwise `null`
 * (including for non-409 errors and 409s from an unrelated cause, e.g. a slug collision).
 */
export function parseWorkflowRevisionConflict(error: unknown): WorkflowRevisionConflictInfo | null {
    const response = asRecord((error as {response?: unknown})?.response)
    if (response?.status !== 409) return null

    const data = asRecord(response.data)
    if (!data) return null

    const detail = data.detail
    const detailRecord = asRecord(detail)
    const code = detailRecord?.code ?? asString(detail) ?? data.code
    if (code !== REVISION_CONFLICT_CODE) return null

    const details =
        asRecord(detailRecord?.details) ?? asRecord(data.details) ?? detailRecord ?? data

    return {
        baseRevisionId: asString(details?.base_revision_id),
        currentRevisionId: asString(details?.current_revision_id),
        currentRevisionVersion: asString(details?.current_revision_version),
    }
}
