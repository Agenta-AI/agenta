import {SharedEditor} from "@agenta/ui/shared-editor"

export interface RunErrorResult {
    error?: unknown
    metadata?: {rawError?: {detail?: string}; retryAfter?: number}
}

const GENERIC_ERRORS = new Set(["An unknown error occurred", "Unknown error", "Error"])

/**
 * The text of a failed run. A generic message gives way to the API's own detail, and a rate limit
 * adds when to retry. The text is the output of the user's own prompt run, so it shows as it came.
 */
export const runErrorText = (result: RunErrorResult): string => {
    let text = typeof result.error === "string" ? result.error : String(result.error ?? "Error")
    if (GENERIC_ERRORS.has(text)) {
        const detail = result.metadata?.rawError?.detail
        if (typeof detail === "string" && detail) text = detail
        const retryAfter = result.metadata?.retryAfter
        if (retryAfter) text = `${text} Retry after ${retryAfter}s.`
    }
    return text
}

/** A failed run: the error text in a read-only editor with the error style. */
export const RunError = ({result}: {result: RunErrorResult}) => (
    <SharedEditor
        initialValue={runErrorText(result)}
        editorType="borderless"
        state="filled"
        readOnly
        disabled
        error
        className="w-full !border-none !p-0 [&_.agenta-rich-text-editor]:!min-h-0"
        editorClassName="min-h-4 [&_p:first-child]:!mt-0"
        handleChange={() => undefined}
    />
)
