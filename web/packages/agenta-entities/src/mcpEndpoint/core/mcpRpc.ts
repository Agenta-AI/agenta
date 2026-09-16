/**
 * Reading what an MCP server answered, over the Streamable HTTP transport.
 *
 * Two facts about that transport decide everything here. A server may answer a single
 * JSON-RPC request either with a JSON body or with an event stream carrying the same
 * payload in `data:` lines, so a reader that assumes a decoded object silently fails on
 * half of the conforming servers. And a JSON-RPC failure is carried in a 200 response's
 * `error` member, so a reader that only looks at `result` turns a refusal into "this
 * server exposes nothing".
 *
 * Every helper here therefore either returns the payload or raises. An empty tool list is
 * a fact about a server; an unreadable answer is a fact about the conversation, and the
 * two must not arrive at the caller as the same value.
 *
 * The same sequence is spoken by `services/runner/src/extensions/pi-mcp.ts` and, for the
 * handshake alone, by the backend probe in `api/oss/src/core/gateways/mcps/probe.py`.
 */
import type {McpToolSummary} from "./connectJourney"

/** The protocol version this client offers. A server that speaks another still answers. */
export const MCP_PROTOCOL_VERSION = "2025-06-18"

/** Both answer shapes the transport allows, which a client must declare it accepts. */
export const MCP_ACCEPT = "application/json, text/event-stream"

/** The header carrying the negotiated version on every call after the handshake. */
export const MCP_PROTOCOL_VERSION_HEADER = "MCP-Protocol-Version"

/**
 * A conversation with an MCP server that did not produce an answer.
 *
 * Distinct from a transport error: the request arrived and something answered it. The
 * message is the server's own wording wherever it wrote one.
 */
export class McpProtocolError extends Error {
    /**
     * The gateway's own cause for the refusal, when one refused it: `auth_required`,
     * `endpoint_inactive`, `tool_not_allowed`. Null when the failure was the server's rather
     * than the gateway's, or when nothing named a cause.
     *
     * Carried on the error because the response it came in does not survive the throw, and a
     * caller deciding what to OFFER a person needs the cause, not the sentence: a connection
     * nobody has authorized wants a Connect button, and a server that is merely down wants a
     * Retry. Reading it back out of the message would mean parsing prose (D50).
     */
    readonly code: string | null

    constructor(message: string, code: string | null = null) {
        super(message)
        this.name = "McpProtocolError"
        this.code = code
    }
}

interface JsonRpcError {
    code?: unknown
    message?: unknown
    data?: unknown
}

interface JsonRpcPayload {
    result?: unknown
    error?: JsonRpcError
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

/** One event's payload: its `data:` lines joined, as the transport specifies. */
const eventData = (event: string): string =>
    event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n")

const parseObject = (text: string): Record<string, unknown> | null => {
    if (!text.trim()) return null
    try {
        const parsed: unknown = JSON.parse(text)
        return isRecord(parsed) ? parsed : null
    } catch {
        return null
    }
}

/**
 * The JSON-RPC payload in a response body, whichever shape it arrived in.
 *
 * Axios decodes a JSON body and leaves an event stream as text, so both reach this. A
 * stream is read from its last event backwards: notifications may precede the answer, and
 * the answer is the last frame that carries one.
 */
export const readJsonRpcPayload = (data: unknown): JsonRpcPayload | null => {
    if (isRecord(data)) return data as JsonRpcPayload

    if (typeof data !== "string") return null

    const events = data.split(/\r?\n\r?\n/)
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        const payload = parseObject(event.includes("data:") ? eventData(event) : event)
        if (payload && ("result" in payload || "error" in payload)) {
            return payload as JsonRpcPayload
        }
    }
    return null
}

/**
 * The sentence in a JSON-RPC `error`, or null when the payload carries none.
 *
 * The gateway's own refusals travel this way too: `api/oss/src/apis/fastapi/gateways/mcps/
 * proxy.py` answers a refused relay with `{error: {code, message, data: {cause}}}`.
 */
export const jsonRpcErrorMessage = (data: unknown): string | null => {
    const payload = readJsonRpcPayload(data)
    const error = payload?.error
    if (!isRecord(error)) return null
    const message = error.message
    return typeof message === "string" && message.trim() ? message.trim() : null
}

/**
 * The gateway's cause for a JSON-RPC refusal, from `error.data.cause`.
 *
 * The gateway states it structurally there; the same word is repeated into the message as a
 * marker for harnesses that keep nothing but the message. Read the structure.
 */
export const jsonRpcErrorCause = (data: unknown): string | null => {
    const payload = readJsonRpcPayload(data)
    const error = payload?.error
    if (!isRecord(error)) return null
    const cause = (error.data as {cause?: unknown} | undefined)?.cause
    return typeof cause === "string" && cause ? cause : null
}

/**
 * The `result` of a call, or a raised `McpProtocolError`.
 *
 * `method` names the call in the raised message, because "initialize" failing and
 * "tools/list" failing send a reader to different places.
 */
export const jsonRpcResult = (data: unknown, method: string): Record<string, unknown> => {
    const payload = readJsonRpcPayload(data)
    if (!payload) {
        throw new McpProtocolError(`The server's answer to ${method} was not JSON-RPC.`)
    }

    const failure = jsonRpcErrorMessage(payload)
    if (failure) throw new McpProtocolError(failure, jsonRpcErrorCause(payload))
    if (payload.error) {
        throw new McpProtocolError(`The server refused ${method}.`, jsonRpcErrorCause(payload))
    }

    if (!isRecord(payload.result)) {
        throw new McpProtocolError(`The server's answer to ${method} carried no result.`)
    }
    return payload.result
}

export interface McpToolPage {
    tools: McpToolSummary[]
    /** The opaque cursor for the next page, or null when this was the last one. */
    nextCursor: string | null
}

/**
 * One page of `tools/list`.
 *
 * A missing or non-array `tools` is a protocol failure rather than an empty server: the
 * member is required, and reading it as "no tools" is how a broken conversation ends up
 * presented as a server worth connecting to and then editing permissions for.
 */
export const readToolPage = (result: Record<string, unknown>): McpToolPage => {
    const tools = result.tools
    if (!Array.isArray(tools)) {
        throw new McpProtocolError("The server's tool list was missing from its answer.")
    }

    const cursor = result.nextCursor
    return {
        tools: tools.flatMap((tool): McpToolSummary[] => {
            if (!isRecord(tool) || typeof tool.name !== "string" || !tool.name) return []
            return [
                {
                    name: tool.name,
                    ...(typeof tool.description === "string"
                        ? {description: tool.description}
                        : {}),
                },
            ]
        }),
        nextCursor: typeof cursor === "string" && cursor ? cursor : null,
    }
}
