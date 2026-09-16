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
import {McpProtocolError} from "./mcpRpc"

interface Envelope {
    message?: unknown
    next_step?: unknown
}

const asText = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

export const gatewayRefusalMessage = (error: unknown): string | null => {
    const data = (error as {response?: {data?: {detail?: unknown; error?: unknown}}})?.response
        ?.data
    const detail = data?.detail

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

    // The data plane refuses in JSON-RPC rather than in `detail`: the relay answers a refused
    // call with `{error: {code, message, data: {cause}}}` (`apis/fastapi/gateways/mcps/
    // proxy.py`). Same refusal, different envelope, and a caller asking why should not have to
    // know which plane it reached.
    const rpcError = data?.error
    if (rpcError && typeof rpcError === "object") {
        const message = asText((rpcError as Envelope).message)
        if (message) return message
    }

    // A failure raised by this package's own MCP client already carries the server's wording.
    if (error instanceof McpProtocolError) return asText(error.message)

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
