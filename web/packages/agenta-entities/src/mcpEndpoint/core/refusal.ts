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
import {jsonRpcErrorCause, McpProtocolError} from "./mcpRpc"

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

/**
 * The refusal's code, wherever the plane that refused happens to state it.
 *
 * Three places, because there are three ways a refusal reaches a caller and a caller asking
 * "why" should not have to know which one it got (D50):
 *
 * - the control plane's typed envelope, `detail.code`;
 * - the data plane's JSON-RPC envelope, `error.data.cause`, which carries no `detail` at all;
 * - a failure this package's own MCP client already read and raised, which kept the cause
 *   because the response it came in did not survive the throw.
 *
 * The marker inside a message is the last resort, for a sender that kept the sentence and
 * dropped the structure around it.
 */
export const gatewayRefusalCode = (error: unknown): string | null => {
    if (error instanceof McpProtocolError) return error.code

    const data = (error as {response?: {data?: {detail?: unknown; error?: unknown}}})?.response
        ?.data
    const detail = data?.detail
    if (detail && typeof detail === "object") {
        const code = (detail as {code?: unknown}).code
        if (typeof code === "string" && code) return code
    }
    const message =
        typeof detail === "string"
            ? detail
            : ((detail as {message?: unknown} | undefined)?.message as string | undefined)
    if (typeof message === "string") {
        const marked = findCodeMarker(message)?.code
        if (marked) return marked
    }

    const cause = jsonRpcErrorCause(data)
    if (cause) return cause

    const rpcMessage = (data?.error as {message?: unknown} | undefined)?.message
    return typeof rpcMessage === "string" ? (findCodeMarker(rpcMessage)?.code ?? null) : null
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

/**
 * The status an answered request carried, or null when nothing answered.
 *
 * Read from the transport for a control-plane call and from the relayed failure for a
 * data-plane one, because a caller asking "did the server refuse this, or did it never
 * reply" should not have to know which plane it reached (the argument `gatewayRefusalCode`
 * makes for the cause).
 *
 * Null is meaningful and is not a zero: it says nothing answered.
 */
export const gatewayRefusalStatus = (error: unknown): number | null => {
    if (error instanceof McpProtocolError) return error.status
    const status = (error as {response?: {status?: unknown}} | null | undefined)?.response?.status
    return typeof status === "number" && status > 0 ? status : null
}

/** The cause the relay gives a refusal it recognised as the chosen server's. */
const UPSTREAM_REFUSED = "upstream_error"

/** The statuses a server answers with about a credential it was given. */
const CREDENTIAL_REFUSED = new Set([401, 403])

/** The sentence our own middleware answers an unauthorised request with, verbatim. */
const OUR_UNAUTHORISED = "Unauthorized"

const bodyOf = (error: unknown): unknown =>
    (error as {response?: {data?: unknown}} | null | undefined)?.response?.data

/**
 * Whether an unauthorised answer is OUR middleware's rather than the chosen server's.
 *
 * Matched on the two shapes we actually produce, not on the presence of a `detail` key: the
 * relay forwards the third party's body verbatim, and a third party may well use that key,
 * so recognising ours loosely would take a genuine wrong-key refusal for a session expiry.
 *
 * The two are `{"detail": "Unauthorized"}`, which both of the middleware's 401 sites answer
 * with, and the wrapped form carrying a message beside an operation id.
 */
const isOurUnauthorised = (error: unknown): boolean => {
    const detail = (bodyOf(error) as {detail?: unknown} | null | undefined)?.detail
    if (detail === OUR_UNAUTHORISED) return true
    if (detail && typeof detail === "object") {
        const {message, operation_id: operationId} = detail as {
            message?: unknown
            operation_id?: unknown
        }
        return typeof message === "string" && typeof operationId === "string"
    }
    return false
}

/**
 * Whether THIS RELAY CALL's failure is the chosen server refusing the credential.
 *
 * Ask it only about the relay call. The submit that reaches it also reads and writes our own
 * API first, and a session that expired made that read answer 401; classified here it would
 * have read as the server rejecting a key it never saw (round 4, D184).
 *
 * Two forms count, because the relay has two behaviours and the difference is the
 * connection's auth mode. An OAuth connection's refusal is mapped to 424 carrying the
 * `upstream_error` cause. An API-KEY connection's is passed through bare, with the third
 * party's status and its body, so a 401 or 403 here is the server's answer unless the body
 * is one our own middleware writes. Requiring the cause would have made a genuine wrong API
 * key stop being recognised, which is the defect D175 closed, reintroduced through its fix.
 */
export const isCredentialRefusal = (error: unknown): boolean => {
    if (gatewayRefusalCode(error) === UPSTREAM_REFUSED) return true
    const status = gatewayRefusalStatus(error)
    if (status === null || !CREDENTIAL_REFUSED.has(status)) return false
    return !isOurUnauthorised(error)
}

/**
 * The status to show beside "the server rejected this key", or null.
 *
 * Only a status the chosen server answered with. A bare relayed 401 or 403 IS that, and this
 * fallback is what keeps the wrong-key screen naming the code for an API-key connection: do
 * not remove it on the grounds that the relay maps upstream failures, because it maps only
 * the OAuth ones. The 424 of that mapped form says the upstream refused and nothing about
 * how, so printing it would put a platform number where the specification asks for the
 * server's, which is the mistake D133 was reopened for; that form names no code until the
 * upstream's status is carried structurally (issue 6926).
 */
export const credentialRefusalStatus = (error: unknown): number | null => {
    const status = gatewayRefusalStatus(error)
    return status !== null && CREDENTIAL_REFUSED.has(status) ? status : null
}
