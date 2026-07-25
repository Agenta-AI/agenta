/**
 * Shared helpers for reading execution-step errors from evaluation results.
 *
 * The evaluation APIs have used a few terminal failure status strings over
 * time. UI callers should not need to duplicate that normalization before
 * showing a step's own error payload.
 */

export interface StepError {
    code?: number
    type?: string
    message: string
    stacktrace?: string
    raw?: unknown
}

const FAILED_STEP_STATUSES = new Set([
    "error",
    "errors",
    "failed",
    "failure",
    "evaluation_failed",
    "evaluation_aggregation_failed",
])

const getErrorMessage = (error: unknown): string => {
    if (typeof error === "string") return error

    if (error && typeof error === "object") {
        const payload = error as Record<string, unknown>
        const candidates = [payload.message, payload.detail, payload.error, payload.type]
        const message = candidates.find(
            (candidate): candidate is string =>
                typeof candidate === "string" && candidate.trim().length > 0,
        )
        if (message) return message
    }

    return "Unknown error"
}

export function extractStepError(step: unknown): StepError | null {
    if (!step || typeof step !== "object") return null

    const payload = step as Record<string, unknown>
    const status = typeof payload.status === "string" ? payload.status.toLowerCase() : ""
    const error = payload.error

    if (!FAILED_STEP_STATUSES.has(status) || error === undefined || error === null) return null

    if (typeof error === "object") {
        const errorPayload = error as Record<string, unknown>
        return {
            code: typeof errorPayload.code === "number" ? errorPayload.code : undefined,
            type: typeof errorPayload.type === "string" ? errorPayload.type : undefined,
            message: getErrorMessage(error),
            stacktrace:
                typeof errorPayload.stacktrace === "string" ? errorPayload.stacktrace : undefined,
            raw: error,
        }
    }

    return {
        message: getErrorMessage(error),
        raw: error,
    }
}
