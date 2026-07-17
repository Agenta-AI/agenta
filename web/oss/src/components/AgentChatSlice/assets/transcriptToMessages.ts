import type {SessionRecord} from "@agenta/entities/session"
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

/**
 * Apply one transcript event's payload onto the current draft.
 *
 * `tools` is TRANSCRIPT-GLOBAL, not per-draft: a parked tool call and the `tool_result` that
 * settles it can land in DIFFERENT turns (the gate is emitted in the paused run, the result in the
 * resume run). Keying tool parts globally lets that later result settle the earlier gate part in
 * place, instead of being dropped for want of a matching part in its own draft — which left the
 * gate stuck at "approval-requested" on reload. The part still lives in the draft where its
 * `tool_call` first appeared.
 */
function applyEvent(
    draft: DraftMessage,
    payload: Record<string, unknown>,
    tools: Map<string, Part>,
): void {
    const type = payload.type as string | undefined
    const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))

    switch (type) {
        case "message": {
            draft.parts.push({type: "text", text: str(payload.text)})
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
            // A keep-alive resume re-emits the parked call's `tool_call` (so the live FE flips it to
            // done); on replay that repeat must UPDATE the existing part, not push a duplicate that
            // orphans the original approval-requested one. Keyed globally, so it also finds a part
            // created in an earlier draft.
            const existing = tools.get(toolCallId)
            if (existing) {
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
            tools.set(toolCallId, part)
            return
        }
        case "tool_result": {
            const part = tools.get(str(payload.id))
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
            let part = tools.get(toolCallId)
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
                tools.set(toolCallId, part)
            }
            // Only park if still unsettled — a later `tool_result` overwrites this.
            if (part.state === "input-available") {
                part.state = "approval-requested"
                part.approval = {id: str(payload.id)}
            }
            return
        }
        case "file": {
            draft.parts.push({
                type: "file",
                url: str(payload.url),
                mediaType: str(payload.mediaType),
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
    // Tool parts are keyed transcript-wide (see applyEvent): a parked gate and its settling result
    // can span two turns (paused run → resume run).
    const tools = new Map<string, Part>()

    for (const row of records) {
        const payload = row.payload
        if (!payload || typeof payload !== "object") continue
        const p = payload as Record<string, unknown>
        // Speculative trace link (no-op until the backend stamps one) — the id can ride the `done`
        // row too, so read it before the turn closes.
        const traceId = extractTraceId(row, p)
        // `done` terminates a turn. Records are runner-output-only (no user rows), so without
        // this every turn folds into one assistant bubble; closing the draft here starts a
        // fresh message per turn. EXCEPT a PAUSED turn's `done`: it is not a real boundary — the
        // turn continues on the resume run — so closing here would sever a parked gate from the
        // result that settles it (gate stuck on reload). Keep the draft open across it.
        if (row.session_update === "done" || p.type === "done") {
            if (current && traceId && !current.traceId) current.traceId = traceId
            if (p.stopReason === "paused") continue
            current = null
            continue
        }
        const role = roleOf(row.sender)
        if (!current || current.role !== role) {
            current = newDraft(row.id, role)
            drafts.push(current)
        }
        if (traceId && !current.traceId) current.traceId = traceId
        applyEvent(current, p, tools)
    }

    const messages = drafts
        .filter((d) => d.parts.length > 0)
        .map((d) => {
            // `getMessageTraceId`/`getMessageUsage` read exactly these, so the hover trace actions
            // and metrics bar light up on reload. traceId stays absent until the backend stamps one;
            // usage is present whenever the turn persisted a `usage` event.
            const metadata: Record<string, unknown> = {}
            if (d.traceId) metadata.traceId = d.traceId
            if (d.usage) metadata.usage = d.usage
            return {
                id: d.id,
                role: d.role,
                parts: d.parts,
                ...(Object.keys(metadata).length > 0 ? {metadata} : {}),
            } as unknown as UIMessage
        })

    return messages.length > 0 ? messages : null
}
