/**
 * The sentence behind a gateway refusal, rather than the transport's status line.
 *
 * Every gateway refusal carries `{code, message, retryable, next_step, details}` in the
 * response body, and a few older paths carry a plain string in `detail`. Axios throws
 * before any of that is read, and its own `message` is "Request failed with status code
 * 424", so a user who hits a refusal sees a number where a reason exists. Discovery
 * against a server that publishes no metadata is the common one: the body says "no
 * protected-resource metadata found" and the dialog used to show the 424.
 *
 * Nothing here invents copy. It returns what the server wrote, or `null` so the caller
 * keeps whatever wording it already had.
 */
interface Envelope {
    message?: unknown
    next_step?: unknown
}

const asText = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

export const gatewayRefusalMessage = (error: unknown): string | null => {
    const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail

    const plain = asText(detail)
    if (plain) return plain

    if (detail && typeof detail === "object") {
        const envelope = detail as Envelope
        const message = asText(envelope.message)
        if (message) {
            const nextStep = asText(envelope.next_step)
            // The next step is the actionable half; a reason without it leaves the reader
            // knowing what happened and not what to do.
            return nextStep ? `${message} ${nextStep}` : message
        }
    }

    return null
}

/** The code the API refuses a duplicate display name with. */
export const MCP_NAME_TAKEN_CODE = "mcp_connection_name_taken"

/**
 * Whether this refusal is "that name is taken".
 *
 * Worth telling apart from every other create failure: it is the one the person can fix in
 * the field they are looking at, and retrying the same name would only repeat it.
 */
export function isNameTakenRefusal(error: unknown): boolean {
    const detail = (error as {response?: {data?: {detail?: unknown}}} | null | undefined)?.response
        ?.data?.detail
    if (!detail || typeof detail !== "object") return false
    return (detail as {code?: unknown}).code === MCP_NAME_TAKEN_CODE
}
