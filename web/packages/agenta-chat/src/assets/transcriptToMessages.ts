// Copied from web/oss/src/components/AgentChatSlice/assets/transcriptToMessages.ts (2026-07-25);
// the OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it.
//
// Re-synced 2026-08-03 to full parity with the original: the approval-resume handling (pause
// folding, the resumed settle pass, tool-call dedup, re-raise under a new toolCallId) — without
// which a resumed turn replays as still parked and the reload keeps the approval dock up — and
// user-attachment parts + `filename` on file parts, without which a message that carried files
// replays as bare text.
//
// `attachmentContentUrl` is the package's own copy of the original's `attachmentMedia.ts`
// builder, on `@agenta/shared/api` rather than the OSS app layer.
import type {
    SessionInteractionRowState,
    SessionInteractionRowStates,
    SessionRecord,
} from "@agenta/entities/session"
import {getAgentaApiUrl} from "@agenta/shared/api"
import {CLIENT_TOOL_INTERACTION_ENDED_OUTPUT} from "@agenta/shared/clientTools"
import type {UIMessage} from "ai"

/**
 * Replay adapter — durable session-record `AgentEvent`s → v6 `UIMessage[]`.
 *
 * The runner persists each ACP `AgentEvent` as one record row (the backend's append-only
 * "records" log, formerly "transcripts"). The live path streams those same events as a Vercel
 * UI Message Stream (`sdk/agents/adapters/vercel/stream.py`) which `useChat` assembles into
 * `UIMessage[]`; this rebuilds the assembled messages directly so replayed history renders
 * identically to a turn this browser streamed live.
 *
 * Grouping: rows arrive ordered (uuid7 `id`). A contiguous run of non-user rows folds into
 * one assistant message; each user row opens a user message. Within an assistant message,
 * tool parts are keyed by `toolCallId` so a later `tool_result` settles the earlier
 * `tool_call`, and a `interaction_request` (permission) marks it awaiting approval.
 */

type Part = Record<string, unknown>

/** Content URL for one durable attachment. Mirrors the OSS original's `attachmentMedia.ts`. */
export function attachmentContentUrl(sessionId: string, attachmentId: string): string {
    const params = new URLSearchParams({session_id: sessionId})
    return `${getAgentaApiUrl()}/sessions/attachments/${encodeURIComponent(attachmentId)}/content?${params.toString()}`
}

// Mirrors services/runner/src/tracing/otel.ts; park sentinels report skipped or unobserved work, not final results.
export const DEFERRED_NOT_EXECUTED_PREFIX = "DEFERRED_NOT_EXECUTED"
export const APPROVED_EXECUTION_RESULT_UNKNOWN =
    "APPROVED_EXECUTION_RESULT_UNKNOWN: the approved call started but its result was not observed before the pause ended the turn; do not assume it failed and do not retry a side-effecting call."
export const APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX = APPROVED_EXECUTION_RESULT_UNKNOWN.slice(
    0,
    APPROVED_EXECUTION_RESULT_UNKNOWN.indexOf(":"),
)

interface DraftMessage {
    id: string
    role: "user" | "assistant"
    parts: Part[]
    /** Open streamed text/reasoning parts keyed by event id, for delta accumulation. */
    text: Map<string, Part>
    reasoning: Map<string, Part>
    /** The turn's observability trace id, if the durable record carries one (see below). */
    traceId?: string
    /** Token/cost totals from the turn's persisted `usage` event, in the raw stream shape. */
    usage?: {input?: number; output?: number; total?: number; cost?: number}
    /** The turn's terminal `done` carried `stopReason:"paused"` — it ended mid-approval, not at a
     *  real boundary. Surfaced on the message so a cold reload's adoption heuristic can compare state. */
    paused?: boolean
    /** The turn paused for approval and then RESUMED to completion (a second, non-paused `done`). */
    resumed?: boolean
}

interface TranscriptIndex {
    tools: Map<string, Part>
    approvals: Map<string, Part>
}

const roleOf = (sender?: string | null): "user" | "assistant" =>
    sender === "user" ? "user" : "assistant"

/**
 * Best-effort trace id for a replayed turn. The durable session records DON'T carry a trace link
 * today, so on reload the trace-hover actions stay dark (the id only exists on the live stream via
 * `message.metadata.traceId`). This reads the shapes the backend is most likely to add it in — a
 * `trace_id` column on the record row, a `trace_id`/`traceId` on the event payload, or a
 * `data-trace` part — so the moment the runner starts stamping one, replayed turns light up with
 * the SAME `metadata.traceId` `getMessageTraceId` already reads. A pure no-op until then.
 */
function extractTraceId(row: SessionRecord, p: Record<string, unknown>): string | undefined {
    const asStr = (v: unknown): string | undefined =>
        typeof v === "string" && v.trim() ? v : undefined

    const rowLike = row as {trace_id?: unknown; traceId?: unknown}
    const rowLevel = asStr(rowLike.trace_id) ?? asStr(rowLike.traceId)
    if (rowLevel) return rowLevel

    const payloadLevel = asStr(p.trace_id) ?? asStr(p.traceId)
    if (payloadLevel) return payloadLevel

    if (p.type === "data-trace") {
        const data = (p.data ?? {}) as {traceId?: unknown; url?: unknown}
        const fromData = asStr(data.traceId)
        if (fromData) return fromData
        const url = asStr(data.url)
        if (url) {
            const tail = url.split("?")[0].split("/").filter(Boolean).pop()
            if (tail) return tail
        }
    }
    return undefined
}

const newDraft = (id: string, role: "user" | "assistant"): DraftMessage => ({
    id,
    role,
    parts: [],
    text: new Map(),
    reasoning: new Map(),
})

const toolPartType = (name?: string | null): string => (name ? `tool-${name}` : "dynamic-tool")

/** Envelope keys an MCP-style `tool_call` record wraps its real arguments in. */
const TOOL_ARGUMENT_ENVELOPE_KEYS = new Set([
    "tool",
    "server",
    "name",
    "toolName",
    "serverName",
    "tool_name",
    "server_name",
])

/**
 * Unwrap a `{tool, server, arguments}` record wrapper to the bare arguments. Card bodies read their
 * fields at the top level (`input.workflow_revision`), and the live stream hands them the ACP
 * `rawInput`, which is already bare — only the durable record carries the wrapper, so without this
 * a replayed call drops to the raw-JSON fallback the same call renders a card for live.
 * Unwraps only when every sibling of `arguments` is a string-valued envelope key, so a tool whose
 * real input carries its own `arguments` field passes through untouched.
 */
function unwrapToolArguments(input: unknown): unknown {
    if (!input || typeof input !== "object" || Array.isArray(input)) return input
    const wrapper = input as Record<string, unknown>
    const args = wrapper.arguments
    if (!args || typeof args !== "object" || Array.isArray(args)) return input
    const siblings = Object.keys(wrapper).filter((key) => key !== "arguments")
    if (siblings.length === 0) return input
    const isEnvelope = siblings.every(
        (key) => TOOL_ARGUMENT_ENVELOPE_KEYS.has(key) && typeof wrapper[key] === "string",
    )
    return isEnvelope ? args : input
}

/** Keys an ACP tool call can carry its resolved agenta tool spec under (`_tool_spec_of`). */
const TOOL_SPEC_KEYS = ["spec", "toolSpec", "resolvedTool", "tool"] as const

/**
 * The gated tool's name, in the live egress's order (`_approval_tool_name`, stream.py:817-833):
 * the STABLE `resolvedName` the runner stamps on the gate first — it is the runner's own
 * `gate.toolName` (acp-interactions.ts:243), the name the permission gate matches on — then the
 * resolved spec's canonical `name`, and only then the ACP display fields, which drift.
 * The durable `tool_call` row carries the harness-wrapped name instead
 * (`mcp.agenta-tools.commit_revision`), so reading it here labelled a replayed gate
 * "Mcp.agenta tools.commit revision" and keyed its "always allow" grant off that string.
 */
function approvalToolName(toolCall: Record<string, unknown>): string | undefined {
    const spec = TOOL_SPEC_KEYS.map((key) => toolCall[key]).find(
        (value): value is Record<string, unknown> =>
            Boolean(value) && typeof value === "object" && !Array.isArray(value),
    )
    const candidates = [
        toolCall.resolvedName,
        spec?.name,
        toolCall.name,
        toolCall.title,
        toolCall.kind,
    ]
    return candidates.find((value): value is string => typeof value === "string" && value !== "")
}

const isRunnerSentinelError = (part: Part): boolean => {
    const errorText = typeof part.errorText === "string" ? part.errorText : ""
    return (
        errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX) ||
        // Prefix, not equality: the code is the contract and the explanation after the colon
        // is prose. `toolSummary` and the desktop's ToolActivity already match this way, so an
        // exact compare here is the odd one out and would silently stop reopening the approval
        // gate if the runner ever appended context.
        errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX)
    )
}

function settleClientToolPart(part: Part, row: SessionInteractionRowState): void {
    if (part.state !== "input-available") return

    if (row.resolution) {
        if (row.resolution.outcome === "error") {
            const error = row.resolution.error
            part.state = "output-error"
            part.errorText =
                typeof error === "string" && error ? error : "The request ended without a result."
        } else {
            const output = row.resolution.output
            part.state = "output-available"
            part.output =
                typeof output === "object" && output !== null && !Array.isArray(output)
                    ? output
                    : {...CLIENT_TOOL_INTERACTION_ENDED_OUTPUT}
        }
        return
    }

    if (row.status === "cancelled" || row.status === "responded" || row.status === "resolved") {
        part.state = "output-available"
        part.output = {...CLIENT_TOOL_INTERACTION_ENDED_OUTPUT}
    }
}

/**
 * An approval gate whose row is terminal. Approval rows always recorded their outcome correctly,
 * so they are trustworthy here. A verdict replays the real answer. A swept row proves only that
 * the gate died unanswered — and that the gated tool never ran — so it settles denied rather than
 * claiming an approval nobody gave. Either way the gate stops reading as still awaiting the user:
 * a dead gate left `approval-requested` holds the message queue forever once the scans that read
 * it cover the whole transcript.
 */
function settleApprovalPart(part: Part, row: SessionInteractionRowState): void {
    if (part.state !== "approval-requested") return

    const verdict = row.resolution?.verdict
    if (verdict === "approved" || verdict === "denied") {
        part.state = "approval-responded"
        part.approval = {id: row.token, approved: verdict === "approved"}
        return
    }
    if (row.status === "cancelled") {
        part.state = "output-denied"
        return
    }
    if (row.status === "responded" || row.status === "resolved") part.state = "approval-responded"
}

function applyInteractionRowStates(
    index: TranscriptIndex,
    interactionRowStates: SessionInteractionRowStates | undefined,
): void {
    if (!interactionRowStates || interactionRowStates.size === 0) return
    for (const row of interactionRowStates.values()) {
        // Token equality supports rows written before the runner stamped the tool-call id; an
        // approval gate is also indexed under its interaction id, which IS the row token.
        const toolCallId = row.toolCallId ?? row.token
        const part = index.tools.get(toolCallId) ?? index.approvals.get(row.token)
        if (!part) continue

        if (row.kind === "user_approval") settleApprovalPart(part, row)
        else if (row.kind === "client_tool" || row.kind === "user_input")
            settleClientToolPart(part, row)
    }
}

/**
 * Replay a parked CLIENT TOOL (`interaction_request` `kind: "client_tool"`): its unsettled tool
 * part plus the sibling `data-render` part that carries `render.kind` — the ONLY thing that tells
 * the client-tool registry which widget to dispatch (strict AI SDK tool chunks can't carry it
 * inline, so the live egress emits the same sibling part). Without it a replayed elicitation
 * resolves to no widget and the fallback settles it as "not handled by this client".
 */
function replayClientTool(
    draft: DraftMessage,
    payload: Record<string, unknown>,
    index: TranscriptIndex,
    str: (v: unknown) => string,
): void {
    const reqPayload = (payload.payload ?? {}) as Record<string, unknown>
    const toolCall = (reqPayload.toolCall ?? {}) as Record<string, unknown>
    const toolCallId = str(
        reqPayload.toolCallId ?? toolCall.id ?? toolCall.toolCallId ?? payload.id,
    )
    if (!toolCallId) return
    const toolName = str(reqPayload.toolName ?? toolCall.name ?? toolCall.title)
    const input = unwrapToolArguments(reqPayload.input ?? toolCall.rawInput ?? toolCall.input)
    let part = index.tools.get(toolCallId)
    if (!part) {
        // The runner parked without first surfacing the tool call — synthesize one.
        part = {
            type: toolPartType(toolName),
            toolCallId,
            state: "input-available",
            input,
        }
        draft.parts.push(part)
        index.tools.set(toolCallId, part)
    } else {
        if (toolName) {
            if (part.type === "dynamic-tool") part.toolName = toolName
            else part.type = toolPartType(toolName)
        }
        if (input !== undefined) part.input = input
    }
    const render = reqPayload.render
    if (render && typeof render === "object" && !Array.isArray(render)) {
        draft.parts.push({type: "data-render", data: {toolCallId, render}})
    }
}

/** Apply one transcript event's payload onto the current assistant/user draft message. */
function applyEvent(
    draft: DraftMessage,
    payload: Record<string, unknown>,
    index: TranscriptIndex,
    sessionId: string,
): void {
    const type = payload.type as string | undefined
    const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

    switch (type) {
        case "message": {
            draft.parts.push({type: "text", text: str(payload.text)})
            const attachments = Array.isArray(payload.attachments) ? payload.attachments : []
            for (const raw of attachments) {
                if (!raw || typeof raw !== "object") continue
                const attachment = raw as Record<string, unknown>
                const attachmentId = str(attachment.attachmentId)
                if (!attachmentId) continue
                draft.parts.push({
                    type: "file",
                    url: attachmentContentUrl(sessionId, attachmentId),
                    mediaType: str(attachment.mediaType) || "application/octet-stream",
                    filename: str(attachment.filename) || undefined,
                    providerMetadata: {
                        agenta: {
                            attachmentId,
                            size: typeof attachment.size === "number" ? attachment.size : undefined,
                        },
                    },
                })
            }
            return
        }
        case "message_start": {
            const part: Part = {type: "text", text: ""}
            draft.parts.push(part)
            draft.text.set(str(payload.id), part)
            return
        }
        case "message_delta": {
            const part = draft.text.get(str(payload.id))
            if (part) part.text = str(part.text) + str(payload.delta)
            return
        }
        case "thought": {
            draft.parts.push({type: "reasoning", text: str(payload.text)})
            return
        }
        case "thought_start": {
            const part: Part = {type: "reasoning", text: ""}
            draft.parts.push(part)
            draft.reasoning.set(str(payload.id), part)
            return
        }
        case "thought_delta": {
            const part = draft.reasoning.get(str(payload.id))
            if (part) part.text = str(part.text) + str(payload.delta)
            return
        }
        case "tool_call": {
            const toolCallId = str(payload.id)
            const existing = index.tools.get(toolCallId)
            if (existing) {
                // A resume re-emits the approved call with the same toolCallId. Update the existing
                // part (kept across the pause boundary) in place instead of rendering a duplicate;
                // its tool_result then settles that one part to a single ✓.
                if (payload.input !== undefined) existing.input = unwrapToolArguments(payload.input)
                return
            }
            const part: Part = {
                type: toolPartType(payload.name as string),
                toolCallId,
                state: "input-available",
                input: unwrapToolArguments(payload.input),
            }
            draft.parts.push(part)
            index.tools.set(toolCallId, part)
            return
        }
        case "tool_result": {
            const part = index.tools.get(str(payload.id))
            if (!part) return
            if (payload.denied) {
                part.state = "output-denied"
            } else if (payload.isError) {
                part.state = "output-error"
                part.errorText = str(payload.output)
            } else {
                part.state = "output-available"
                part.output = payload.data !== undefined ? payload.data : payload.output
            }
            return
        }
        case "interaction_request": {
            // Two kinds replay: `user_approval` (the Approve/Deny gate, below) and `client_tool`
            // (a parked browser-fulfilled call). `user_input` is left to its tool_call/result parts.
            if (payload.kind === "client_tool") {
                replayClientTool(draft, payload, index, str)
                return
            }
            if (payload.kind !== "user_approval") return
            const reqPayload = (payload.payload ?? {}) as Record<string, unknown>
            const toolCall = (reqPayload.toolCall ?? {}) as Record<string, unknown>
            const toolCallId = str(
                reqPayload.toolCallId ?? toolCall.id ?? toolCall.toolCallId ?? payload.id,
            )
            const toolName = approvalToolName(toolCall)
            let part = index.tools.get(toolCallId)
            if (!part) {
                // The runner parked without first surfacing the tool call — synthesize one.
                part = {
                    type: toolPartType(toolName),
                    toolCallId,
                    state: "input-available",
                    input: unwrapToolArguments(toolCall.rawInput ?? toolCall.input),
                }
                draft.parts.push(part)
                index.tools.set(toolCallId, part)
            } else if (toolName) {
                // Live re-stamps an already-surfaced call with the gate's resolved name
                // (stream.py:711-726), so the card never shows the durable row's harness-wrapped
                // name. Rename here too, or the same gate replays under a different name than it
                // streamed — and `useAlwaysAllowTool` keys the grant off that name verbatim.
                if (part.type === "dynamic-tool") part.toolName = toolName
                else part.type = toolPartType(toolName)
            }
            index.approvals.set(str(payload.id), part)
            const canRequestApproval =
                part.state === "input-available" ||
                (part.state === "output-error" && isRunnerSentinelError(part))
            if (canRequestApproval) {
                delete part.errorText
                delete part.output
                part.state = "approval-requested"
                part.approval = {id: str(payload.id)}
            }
            return
        }
        case "interaction_response": {
            if (payload.kind !== "user_approval") return
            const responsePayload = (payload.payload ?? {}) as Record<string, unknown>
            const responseId = str(payload.id)
            const toolCallId = str(responsePayload.toolCallId)
            // A cold resume re-raises the approved call under a NEW toolCallId, so the interaction
            // id (identical on request and response by contract) is the reliable key to the gate.
            const part =
                index.approvals.get(responseId) ??
                (toolCallId ? index.tools.get(toolCallId) : undefined)
            if (!part || typeof responsePayload.approved !== "boolean") return
            if (part.state === "approval-requested") {
                part.state = "approval-responded"
                part.approval = {id: responseId, approved: responsePayload.approved}
            }
            if (!toolCallId || toolCallId === str(part.toolCallId)) return
            // Re-raised under a new id: point that id at the gated part and fold in the duplicate
            // it created — an executed result supersedes the approval-responded state.
            const duplicate = index.tools.get(toolCallId)
            index.tools.set(toolCallId, part)
            if (!duplicate || duplicate === part) return
            const at = draft.parts.indexOf(duplicate)
            if (at >= 0) draft.parts.splice(at, 1)
            if (duplicate.input !== undefined) part.input = duplicate.input
            if (typeof duplicate.state === "string" && duplicate.state.startsWith("output-")) {
                part.state = duplicate.state
                if (duplicate.output !== undefined) part.output = duplicate.output
                if (duplicate.errorText !== undefined) part.errorText = duplicate.errorText
            }
            return
        }
        case "file": {
            draft.parts.push({
                type: "file",
                url: str(payload.url),
                mediaType: str(payload.mediaType),
                filename: str(payload.filename) || undefined,
            })
            return
        }
        case "error": {
            // No error part in the renderer; surface the text so the failure stays visible.
            draft.parts.push({type: "text", text: str(payload.message)})
            return
        }
        case "usage": {
            // No renderable part, but the token/cost totals feed the turn's metrics bar. The
            // runner may persist a partial `usage_update` then a final full-split `usage`; merge
            // field-by-field so the last defined value wins (final setUsage carries input/output).
            const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)
            const next = draft.usage ?? {}
            const input = num(payload.input)
            const output = num(payload.output)
            const total = num(payload.total)
            const cost = num(payload.cost)
            if (input !== undefined) next.input = input
            if (output !== undefined) next.output = output
            if (total !== undefined) next.total = total
            if (cost !== undefined) next.cost = cost
            draft.usage = next
            return
        }
        // done / data carry no renderable message part — drop.
        default:
            return
    }
}

export interface TranscriptToMessagesOptions {
    /** Row lifecycle settles replayed interactions; omit it to preserve record-only replay. */
    interactionRowStates?: SessionInteractionRowStates
}

/**
 * Convert a session's ordered transcript rows into v6 `UIMessage[]`. Returns `null` when
 * there is nothing renderable (empty transcript or only metadata events) so the caller can
 * fall back to local history.
 */
export function transcriptToMessages(
    records: SessionRecord[],
    options?: TranscriptToMessagesOptions,
): UIMessage[] | null {
    const drafts: DraftMessage[] = []
    let current: DraftMessage | null = null
    // Paused resumes close the draft, but later answers and results still target its tool part.
    const index: TranscriptIndex = {tools: new Map(), approvals: new Map()}

    for (const row of records) {
        const payload = row.payload
        if (!payload || typeof payload !== "object") continue
        const p = payload as Record<string, unknown>
        // Speculative trace link (no-op until the backend stamps one) — the id can ride the `done`
        // row too, so read it before the turn closes.
        const traceId = extractTraceId(row, p)
        // `done` terminates a turn. Records are runner-output-only (no user rows), so without
        // this every turn folds into one assistant bubble; closing the draft here starts a
        // fresh message per turn.
        if (row.session_update === "done" || p.type === "done") {
            // Last-wins: a paused turn folds into its resume (below), and that turn has two `done`s
            // with two traceIds — prefer the RESUME trace, where the approved tool actually executed.
            // A normal turn has a single `done`, so this is unchanged for it.
            if (current && traceId) current.traceId = traceId
            if (current && p.stopReason === "paused") {
                // Paused mid-approval: the resume turn's records (the re-emitted call, its result,
                // the follow-up text) belong to the SAME assistant turn the user saw live, so keep
                // the draft OPEN and let them fold into it instead of splitting into a dangling
                // "awaiting approval" bubble + a resumed bubble. A paused turn blocks the session,
                // so it's always followed by its own resume or is the last (abandoned) turn. Mark it
                // paused for the adoption heuristic; the normal `done` below clears it on resume.
                current.paused = true
                continue
            }
            // A resumed-then-completed turn is no longer paused.
            if (current?.paused) current.resumed = true
            if (current) current.paused = false
            current = null
            continue
        }
        const role = roleOf(row.sender)
        if (!current || current.role !== role) {
            current = newDraft(row.id, role)
            drafts.push(current)
        }
        if (traceId && !current.traceId) current.traceId = traceId
        applyEvent(current, p, index, row.session_id)
    }

    // A RESUMED turn's gate was answered by definition — the runner only emits post-pause records
    // once the user responded (a deny settles its own part via `tool_result denied`). The durable
    // log doesn't always persist the `interaction_response`, so settle whatever is left awaiting:
    // otherwise a completed turn replays as still parked and the reload keeps the approval dock up.
    for (const d of drafts) {
        if (!d.resumed) continue
        for (const part of d.parts) {
            if (part.state === "approval-requested") part.state = "approval-responded"
        }
    }

    // Recorded results win; otherwise saved answers, neutral terminal state, then pending.
    applyInteractionRowStates(index, options?.interactionRowStates)

    const messages = drafts
        .filter((d) => d.parts.length > 0)
        .map((d) => {
            // `getMessageTraceId`/`getMessageUsage` read exactly these, so the hover trace actions
            // and metrics bar light up on reload. traceId stays absent until the backend stamps one;
            // usage is present whenever the turn persisted a `usage` event.
            const metadata: Record<string, unknown> = {}
            if (d.traceId) metadata.traceId = d.traceId
            if (d.usage) metadata.usage = d.usage
            if (d.paused) metadata.paused = true
            return {
                id: d.id,
                role: d.role,
                parts: d.parts,
                ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
            } as unknown as UIMessage
        })

    return messages.length > 0 ? messages : null
}
