/**
 * Canned AI SDK v6 (beta) UI-message-stream builders for the elicitation E2E (layer A).
 *
 * These reproduce, byte for byte, the SSE a real agent run streams when a `request_input`
 * client tool pauses — WITHOUT a live LLM or backend agent. A Playwright `page.route` on
 * `**​/invoke*` fulfils with these bytes, so the whole emit → render → settle → resume →
 * replay path is exercised deterministically. The wire shapes are pinned against the real
 * producer (`sdks/python/agenta/sdk/agents/adapters/vercel/{stream,sse}.py`):
 *
 *   - framing: one `data: <json>\n\n` per chunk, terminated by `data: [DONE]\n\n`
 *   - a paused client-tool turn ends with the tool part left in `input-available` (no output),
 *     the render kind riding a sibling `data-render` part, and `finish` reason `"other"`
 *   - the response Content-Type MUST be `text/event-stream`, else the FE's negotiating fetch
 *     (`agentNegotiation.ts`) treats a 200 as batch JSON and never runs the SSE parser
 *
 * If the wire ever changes, these builders are the single place to update on the FE-test side.
 */

/** The flat elicitation payload the mocked `request_input` call carries (drives the form). */
export interface ElicitationFieldFixture {
    type: "string" | "number" | "integer" | "boolean" | "array"
    title?: string
    enum?: string[]
    /** Context-ful options (oneOf+const) — descriptions upgrade the control to choice cards. */
    oneOf?: {const: string; title?: string; description?: string}[]
    /** Multi-select: the one admitted array shape (string items, optional enum/oneOf). */
    items?: {type: "string"; enum?: string[]; oneOf?: {const: string; title?: string}[]}
    format?: string
    /** Proposed value prefilling the field (one-click accept). */
    default?: string | number | boolean | string[]
}

export interface ElicitationPayloadFixture {
    message: string
    requestedSchema: {
        type: "object"
        properties: Record<string, ElicitationFieldFixture>
        required?: string[]
        "x-ag-stepper"?: boolean
    }
}

/** A two-field form (required text + enum dropdown) plus an optional multiline field. */
export const ELICITATION_PAYLOAD: ElicitationPayloadFixture = {
    message: "Tell me a bit about you.",
    requestedSchema: {
        type: "object",
        properties: {
            name: {type: "string", title: "First Name"},
            color: {type: "string", title: "Favorite Color", enum: ["red", "green", "blue"]},
            notes: {type: "string", title: "Notes", format: "multiline"},
        },
        required: ["name"],
    },
}

/**
 * The full-dialect payload (defaults + multi-select + choice cards) for the one-click-accept
 * spec: every field carries a proposed default, so Accept with no edits must resume with
 * exactly these values. The `release_process` oneOf descriptions upgrade it to choice cards.
 */
export const RICH_ELICITATION_PAYLOAD: ElicitationPayloadFixture = {
    message: "Confirm the setup — I proposed sensible defaults.",
    requestedSchema: {
        type: "object",
        properties: {
            release_process: {
                type: "string",
                title: "Release process",
                oneOf: [
                    {
                        const: "merge_main",
                        title: "Merge to main",
                        description: "A daily trigger checks merged PRs.",
                    },
                    {
                        const: "gh_releases",
                        title: "GitHub releases",
                        description: "Runs when a release is published.",
                    },
                ],
                default: "gh_releases",
            },
            notify_on: {
                type: "array",
                title: "Notify on",
                items: {type: "string", enum: ["success", "failure", "skipped"]},
                default: ["failure"],
            },
            task_manager: {
                type: "string",
                title: "Task management system",
                enum: ["todoist", "notion", "asana"],
                default: "notion",
            },
        },
        required: ["release_process"],
    },
}

/** Choice-card stepper used to verify that the advertised keyboard shortcuts own focus. */
export const STEPPER_ELICITATION_PAYLOAD: ElicitationPayloadFixture = {
    ...RICH_ELICITATION_PAYLOAD,
    message: "Choose the release setup.",
    requestedSchema: {
        ...RICH_ELICITATION_PAYLOAD.requestedSchema,
        "x-ag-stepper": true,
    },
}

/** The reserved static-catalog client-tool name the platform emits for elicitation. */
export const REQUEST_INPUT_TOOL_NAME = "__ag__request_input"

const frame = (chunk: Record<string, unknown>): string => `data: ${JSON.stringify(chunk)}\n\n`

const DONE = "data: [DONE]\n\n"

/**
 * A paused elicitation turn: optional preamble text, then the `request_input` tool call left
 * unsettled (`tool-input-available`, no output) with its sibling `data-render` part, then the
 * turn closes with `finish` reason `"other"` (the runner's `paused` maps to `other`). The FE
 * reads the unsettled last-message tool part as a parked client tool and renders the form.
 */
export function elicitationPausedTurn(opts: {
    messageId: string
    toolCallId: string
    payload: ElicitationPayloadFixture
    preamble?: string
    toolName?: string
}): string {
    const {messageId, toolCallId, payload, preamble, toolName = REQUEST_INPUT_TOOL_NAME} = opts
    const chunks: string[] = [frame({type: "start", messageId}), frame({type: "start-step"})]
    if (preamble) {
        chunks.push(
            frame({type: "text-start", id: `${messageId}-t`}),
            frame({type: "text-delta", id: `${messageId}-t`, delta: preamble}),
            frame({type: "text-end", id: `${messageId}-t`}),
        )
    }
    chunks.push(
        frame({type: "tool-input-start", toolCallId, toolName}),
        frame({type: "tool-input-available", toolCallId, toolName, input: payload}),
        frame({type: "data-render", data: {toolCallId, render: {kind: "elicitation"}}}),
        frame({type: "finish-step"}),
        frame({type: "finish", finishReason: "other"}),
        DONE,
    )
    return chunks.join("")
}

/**
 * A normal resume turn (streamed text) — what the agent "says" after the form is submitted and
 * the settled tool output is resent. `finish` reason is `"stop"`. Use the echoed text to assert
 * the run genuinely resumed with the submitted values.
 */
export function resumeTextTurn(opts: {messageId: string; text: string}): string {
    const {messageId, text} = opts
    return [
        frame({type: "start", messageId}),
        frame({type: "start-step"}),
        frame({type: "text-start", id: `${messageId}-t`}),
        frame({type: "text-delta", id: `${messageId}-t`, delta: text}),
        frame({type: "text-end", id: `${messageId}-t`}),
        frame({type: "finish-step"}),
        frame({type: "finish", finishReason: "stop"}),
        DONE,
    ].join("")
}

/** Playwright `route.fulfill` options for an SSE body — Content-Type is load-bearing (see header). */
export function sseFulfill(body: string) {
    return {
        status: 200,
        contentType: "text/event-stream",
        headers: {
            "x-vercel-ai-ui-message-stream": "v1",
            "x-ag-messages-format": "vercel",
            "x-ag-messages-version": "v1",
            "cache-control": "no-cache",
        },
        body,
    }
}
