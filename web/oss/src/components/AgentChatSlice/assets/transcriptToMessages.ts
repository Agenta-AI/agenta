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
    /** Tool parts keyed by toolCallId so results/approvals attach to the right call. */
    tools: Map<string, Part>
}

const roleOf = (sender?: string | null): "user" | "assistant" =>
    sender === "user" ? "user" : "assistant"

const newDraft = (id: string, role: "user" | "assistant"): DraftMessage => ({
    id,
    role,
    parts: [],
    text: new Map(),
    reasoning: new Map(),
    tools: new Map(),
})

const toolPartType = (name?: string | null): string => (name ? `tool-${name}` : "dynamic-tool")

/** Apply one transcript event's payload onto the current assistant/user draft message. */
function applyEvent(draft: DraftMessage, payload: Record<string, unknown>): void {
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
            const part: Part = {
                type: toolPartType(payload.name as string),
                toolCallId,
                state: "input-available",
                input: payload.input,
            }
            draft.parts.push(part)
            draft.tools.set(toolCallId, part)
            return
        }
        case "tool_result": {
            const part = draft.tools.get(str(payload.id))
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
            let part = draft.tools.get(toolCallId)
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
                draft.tools.set(toolCallId, part)
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
        // usage / done / data / render-hints carry no renderable message part — drop.
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

    for (const row of records) {
        const payload = row.payload
        if (!payload || typeof payload !== "object") continue
        const role = roleOf(row.sender)
        if (!current || current.role !== role) {
            current = newDraft(row.id, role)
            drafts.push(current)
        }
        applyEvent(current, payload as Record<string, unknown>)
    }

    const messages = drafts
        .filter((d) => d.parts.length > 0)
        .map((d) => ({id: d.id, role: d.role, parts: d.parts}) as unknown as UIMessage)

    return messages.length > 0 ? messages : null
}
