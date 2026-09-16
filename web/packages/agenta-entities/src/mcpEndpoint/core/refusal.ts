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

/**
 * The marker a typed gateway refusal carries for harness recovery, e.g.
 * `⟦agenta_code:auth_required⟧`. It is addressed to the runner, not to a person, and it
 * reached the screen verbatim beside a raw `custom/<slug>` (QA-D3).
 */
const MARKER_OPEN = "⟦agenta_code:"
const MARKER_CLOSE = "⟧"

/**
 * Where the marker sits in a string, and what it says.
 *
 * Found by scanning for two literals rather than by matching a pattern. The pattern this
 * replaces began with `\s*`, which a regex engine retries from every position in a run of
 * whitespace: the time it took grew with the square of the length, and the length is that of a
 * message body written by whatever server the person pointed us at. Two `indexOf` calls read
 * each character once (CodeQL js/polynomial-redos).
 */
const findCodeMarker = (value: string): {start: number; end: number; code: string} | null => {
    const open = value.indexOf(MARKER_OPEN)
    if (open === -1) return null
    const codeStart = open + MARKER_OPEN.length
    const close = value.indexOf(MARKER_CLOSE, codeStart)
    // An empty code is no code: the old pattern required at least one character between the
    // delimiters, and a marker it could not read stayed in the text rather than eating it.
    if (close === -1 || close === codeStart) return null
    return {start: open, end: close + MARKER_CLOSE.length, code: value.slice(codeStart, close)}
}

/** The refusal's code, from the envelope or from the marker in its message. */
export const gatewayRefusalCode = (error: unknown): string | null => {
    const detail = (error as {response?: {data?: {detail?: unknown}}})?.response?.data?.detail
    if (detail && typeof detail === "object") {
        const code = (detail as {code?: unknown}).code
        if (typeof code === "string" && code) return code
    }
    const message =
        typeof detail === "string"
            ? detail
            : ((detail as {message?: unknown} | undefined)?.message as string | undefined)
    return typeof message === "string" ? (findCodeMarker(message)?.code ?? null) : null
}

const asText = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const marker = findCodeMarker(value)
    // The marker takes the whitespace on either side of it with it, so removing one from the
    // middle of a sentence leaves one space behind rather than three.
    const withoutMarker = marker
        ? [value.slice(0, marker.start).trimEnd(), value.slice(marker.end).trimStart()]
              .filter(Boolean)
              .join(" ")
        : value.trim()
    return withoutMarker ? withoutMarker : null
}

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
