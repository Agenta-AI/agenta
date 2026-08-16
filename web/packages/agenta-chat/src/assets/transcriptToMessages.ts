// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import type {SessionRecord} from "@agenta/entities/session"
import {getAgentaApiUrl} from "@agenta/shared/api"
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
    /** The turn's persisted `error` event — replayed through the same `metadata.runError` channel
     *  the live stream stamps, so a failure renders as the error bubble, not as body text. */
    runError?: string
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
                if (payload.input !== undefined) existing.input = payload.input
                return
            }
            const part: Part = {
                type: toolPartType(payload.name as string),
                toolCallId,
                state: "input-available",
                input: payload.input,
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
            // v1 scope: HITL approvals only. The runner emits `kind` `user_approval` for the
            // Approve/Deny gate; `user_input`/`client_tool` are left to their tool_call/result
            // parts (a client tool isn't approve/deny) until those are wired.
            if (payload.kind !== "user_approval") return
            const reqPayload = (payload.payload ?? {}) as Record<string, unknown>
            const toolCall = (reqPayload.toolCall ?? {}) as Record<string, unknown>
            const toolCallId = str(
                reqPayload.toolCallId ?? toolCall.id ?? toolCall.toolCallId ?? payload.id,
            )
            let part = index.tools.get(toolCallId)
            if (!part) {
                // The runner parked without first surfacing the tool call — synthesize one.
                part = {
                    type: toolPartType(
                        (toolCall.name as string) ||
                            (toolCall.title as string) ||
                            (toolCall.kind as string),
                    ),
                    toolCallId,
                    state: "input-available",
                    input: toolCall.rawInput ?? toolCall.input,
                }
                draft.parts.push(part)
                index.tools.set(toolCallId, part)
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
            // Stamp the run failure, don't push it as text: a replayed error must render through
            // the same red bubble as a live one. First non-empty wins — a cascading later error
            // must not mask the root cause.
            const message = str(payload.message).trim()
            if (message && !draft.runError) draft.runError = message
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
        // done / data / render-hints carry no renderable message part — drop.
        default:
            return
    }
}

/**
 * Convert a session's ordered transcript rows into v6 `UIMessage[]`. Returns `null` when
 * there is nothing renderable (empty transcript or only metadata events) so the caller can
 * fall back to local history.
 */
export function transcriptToMessages(records: SessionRecord[]): UIMessage[] | null {
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

    const messages = drafts
        // A turn whose only content was the failure has no parts — keep it, or the error vanishes.
        .filter((d) => d.parts.length > 0 || d.runError)
        .map((d) => {
            // `getMessageTraceId`/`getMessageUsage` read exactly these, so the hover trace actions
            // and metrics bar light up on reload. traceId stays absent until the backend stamps one;
            // usage is present whenever the turn persisted a `usage` event.
            const metadata: Record<string, unknown> = {}
            if (d.traceId) metadata.traceId = d.traceId
            if (d.usage) metadata.usage = d.usage
            if (d.paused) metadata.paused = true
            if (d.runError) metadata.runError = {message: d.runError}
            return {
                id: d.id,
                role: d.role,
                parts: d.parts,
                ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
            } as unknown as UIMessage
        })

    return messages.length > 0 ? messages : null
}
