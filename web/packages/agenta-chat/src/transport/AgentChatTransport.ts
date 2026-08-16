// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {createNegotiatingFetch, type NegotiatingFetch} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import {DefaultChatTransport, type UIMessage, type UIMessageChunk} from "ai"

/**
 * Agent chat transport.
 *
 * `useChat` only renders a stream of `UIMessageChunk`s — it has no "batch" mode. So when the run
 * resolves to a batch (the toggle forced it, or the backend fell back because the handler can't
 * stream), the backend returns a single `WorkflowBatchResponse` (JSON) and this transport replays
 * it as a ONE-SHOT UIMessage stream — the same chunk sequence the SSE path emits — so the reply
 * lands in a single frame. A real stream delegates to the default SSE parser unchanged.
 *
 * Which channel resolved is decided by the `createNegotiatingFetch` middleware, NOT a fixed
 * toggle: it requests the stream, falls back to a batch re-request on a 406 (handler can't
 * stream), and passes any other error through so `useChat` surfaces it inline. The transport
 * parses the body according to the channel that fetch actually resolved (`resolvedMode`), so the
 * request and the response handling can never disagree.
 */
type AnyChunk = UIMessageChunk

interface BatchPart {
    type?: string
    text?: string
    toolCallId?: string
    input?: unknown
    output?: unknown
}

interface BatchMessage {
    id?: string
    role?: string
    /** Vercel UIMessage shape. */
    parts?: BatchPart[]
    /** Neutral Message shape: a plain string or a list of content blocks. */
    content?: unknown
}

/** A neutral content block (`text`, `tool_use`, `tool_result`, `thinking`, …). */
interface ContentBlock {
    type?: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: unknown
    output?: unknown
    content?: unknown
    tool_use_id?: string
}

/**
 * Normalize a batch message into UIMessage `parts`, accepting BOTH shapes the backend may emit:
 *  - a Vercel UIMessage that already has `parts`, or
 *  - a neutral Message `{role, content}` where `content` is a string or a list of content blocks
 *    (what the agent `/invoke` batch path actually returns today — confirmed in QA).
 */
function normalizeToParts(msg: BatchMessage | undefined): BatchPart[] {
    if (!msg) return []
    if (Array.isArray(msg.parts)) return msg.parts

    const content = msg.content
    if (typeof content === "string") return content ? [{type: "text", text: content}] : []
    if (Array.isArray(content)) {
        const parts: BatchPart[] = []
        for (const raw of content) {
            const b = (raw ?? {}) as ContentBlock
            if (b.type === "text" && typeof b.text === "string") {
                parts.push({type: "text", text: b.text})
            } else if (b.type === "thinking" || b.type === "reasoning") {
                parts.push({type: "reasoning", text: b.text ?? b.thinking ?? ""})
            } else if (b.type === "tool_use") {
                parts.push({type: `tool-${b.name ?? ""}`, toolCallId: b.id, input: b.input})
            } else if (b.type === "tool_result") {
                parts.push({
                    type: "tool-",
                    toolCallId: b.tool_use_id ?? b.id,
                    output: b.content ?? b.output,
                })
            } else if (typeof b.text === "string") {
                parts.push({type: "text", text: b.text})
            }
        }
        return parts
    }
    return []
}

/**
 * Pull the assistant message out of a `WorkflowBatchResponse`. `data.outputs` is typed `Any`
 * server-side; the agent's canonical output is `outputs.messages` (a `{messages: [...]}`
 * envelope), but accept the other plausible shapes too (a single `{role, content}`, a bare
 * list, a UIMessage with `parts`, or a bare string). Falls back to stringifying whatever
 * arrived so a turn never renders empty.
 */
function extractAssistantMessage(json: unknown): BatchMessage {
    const root = (json ?? {}) as Record<string, unknown>
    const data = (root.data ?? {}) as Record<string, unknown>
    const outputs = data.outputs ?? root.outputs ?? root

    if (typeof outputs === "string") {
        return {role: "assistant", parts: [{type: "text", text: outputs}]}
    }

    let candidates: BatchMessage[] = []
    if (Array.isArray(outputs)) candidates = outputs as BatchMessage[]
    else if (Array.isArray((outputs as Record<string, unknown>)?.messages))
        candidates = (outputs as {messages: BatchMessage[]}).messages
    else if (outputs && typeof outputs === "object") candidates = [outputs as BatchMessage]

    const chosen =
        [...candidates].reverse().find((m) => m?.role === "assistant") ??
        candidates[candidates.length - 1]
    const parts = normalizeToParts(chosen)
    if (parts.length > 0) return {id: chosen?.id, role: "assistant", parts}

    return {role: "assistant", parts: [{type: "text", text: JSON.stringify(outputs ?? "")}]}
}

/** Replay a one-message `WorkflowBatchResponse` as a one-shot v6 UIMessage stream. Buffering the
 * whole body is fine here — batch is a single JSON response, not a stream. */
function batchJsonToUiMessageStream(
    byteStream: ReadableStream<Uint8Array>,
): ReadableStream<AnyChunk> {
    return new ReadableStream<AnyChunk>({
        async start(controller) {
            const emit = (c: Record<string, unknown>) => controller.enqueue(c as AnyChunk)
            try {
                const text = await new Response(byteStream).text()
                const json = text ? JSON.parse(text) : {}
                const msg = extractAssistantMessage(json)
                const sessionId = (json as Record<string, unknown>)?.session_id
                const traceId =
                    (json as Record<string, unknown>)?.trace_id ??
                    ((json as Record<string, unknown>)?.data as Record<string, unknown>)?.trace_id

                // Unique fallback id per replay — a constant made every id-less batch turn
                // collide on the same React key (duplicate-key warning + dropped turns).
                const start: Record<string, unknown> = {
                    type: "start",
                    messageId: msg.id ?? `msg-batch-${generateId()}`,
                }
                if (sessionId) start.messageMetadata = {sessionId}
                emit(start)
                emit({type: "start-step"})

                let seq = 0
                for (const part of msg.parts ?? []) {
                    seq += 1
                    const t = part?.type
                    if (t === "text") {
                        const id = `text-${seq}`
                        emit({type: "text-start", id})
                        emit({type: "text-delta", id, delta: part.text ?? ""})
                        emit({type: "text-end", id})
                    } else if (t === "reasoning") {
                        const id = `reasoning-${seq}`
                        emit({type: "reasoning-start", id})
                        emit({type: "reasoning-delta", id, delta: part.text ?? ""})
                        emit({type: "reasoning-end", id})
                    } else if (typeof t === "string" && t.startsWith("tool-")) {
                        // A UIMessage tool part → re-emit as the tool input/output chunks.
                        const toolCallId = part.toolCallId ?? `tool-${seq}`
                        const toolName = t.slice("tool-".length)
                        // A neutral `tool_result` block normalizes to a nameless `tool-` part
                        // carrying only the output, under the SAME toolCallId as its sibling
                        // `tool_use`. The AI SDK keys tool parts by that id, so emitting an
                        // input chunk here would overwrite the real name and input with "" and
                        // undefined, and the turn would render an unnamed call.
                        if (toolName) {
                            emit({
                                type: "tool-input-available",
                                toolCallId,
                                toolName,
                                input: part.input,
                            })
                        }
                        if (part.output !== undefined) {
                            emit({type: "tool-output-available", toolCallId, output: part.output})
                        }
                    } else if (typeof part?.text === "string" && part.text) {
                        // Unknown part with text → surface it as text rather than dropping it.
                        const id = `text-${seq}`
                        emit({type: "text-start", id})
                        emit({type: "text-delta", id, delta: part.text})
                        emit({type: "text-end", id})
                    }
                }

                emit({type: "finish-step"})
                const finish: Record<string, unknown> = {type: "finish"}
                if (traceId) finish.messageMetadata = {traceId}
                emit(finish)
                controller.close()
            } catch (err) {
                emit({
                    type: "error",
                    errorText: err instanceof Error ? err.message : String(err),
                })
                controller.close()
            }
        },
    })
}

/** Per-piece pacing for the smooth stream: base cadence, and a per-chunk time budget so a
 * huge delta (multiple paragraphs in one SSE event) still lands within about a second instead
 * of faking a minute of typing. */
const SMOOTH_BASE_MS = 18
const SMOOTH_CHUNK_BUDGET_MS = 1200

/**
 * Smooth the text stream: the backend emits deltas at whatever granularity it batches (often
 * several sentences or paragraphs per event), which makes the UI "type" whole paragraphs at
 * once. This re-emits each text delta as word-sized pieces on a timed cadence, so downstream
 * consumers (streamdown's token animation) see genuinely incremental text. Non-text chunks
 * pass through in order (the pump is sequential, so a tool call never overtakes its preceding
 * prose). The budget cap keeps total added latency bounded per chunk.
 */
function smoothTextStream(upstream: ReadableStream<AnyChunk>): ReadableStream<AnyChunk> {
    const reader = upstream.getReader()
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    // The pieces of the delta currently being paced out, CARRIED ACROSS `pull()` calls. A delta
    // used to be flushed entirely within the pull that read it, which was fine only because the
    // per-piece sleep yielded between pieces — and past ~1,200 pieces the budget share drops below
    // a millisecond, the sleep is skipped, and the whole thing became one synchronous burst of
    // thousands of enqueues that never yielded and never re-consulted the consumer. Keeping the
    // leftovers here lets a pull stop the moment the consumer is full and resume when it asks again.
    let pending: AnyChunk[] = []
    let pendingDelay = 0
    return new ReadableStream<AnyChunk>({
        async pull(controller) {
            if (pending.length === 0) {
                const {done, value} = await reader.read()
                if (done) {
                    controller.close()
                    return
                }
                const chunk = value as {type?: string; delta?: string}
                // Pace every delta-carrying chunk kind (text-delta, reasoning-delta, and any other
                // alias the projection uses) — matching exact names is how thinking slipped through.
                const paced = typeof chunk?.type === "string" && chunk.type.endsWith("-delta")
                if (!paced || typeof chunk.delta !== "string") {
                    controller.enqueue(value)
                    return
                }
                // Split keeping whitespace attached to the preceding word, so reassembly is exact.
                const pieces = chunk.delta.match(/\S+\s*|\s+/g) ?? [chunk.delta]
                if (pieces.length <= 1) {
                    controller.enqueue(value)
                    return
                }
                pending = pieces.map((piece) => ({...(value as object), delta: piece}) as AnyChunk)
                pendingDelay = Math.min(SMOOTH_BASE_MS, SMOOTH_CHUNK_BUDGET_MS / pieces.length)
            }
            // Emit until the delta runs out or the consumer stops asking for more. Returning with
            // pieces still pending is the backpressure: the stream calls `pull` again once its
            // queue drains, and the cadence below is unchanged for normal-sized deltas.
            do {
                controller.enqueue(pending.shift() as AnyChunk)
                if (pending.length === 0) return
                if (pendingDelay >= 1) await sleep(pendingDelay)
            } while ((controller.desiredSize ?? 1) > 0)
        },
        cancel(reason) {
            pending = []
            return reader.cancel(reason)
        },
    })
}

export class AgentChatTransport extends DefaultChatTransport<UIMessage> {
    private readonly negotiator: NegotiatingFetch

    constructor(options: ConstructorParameters<typeof DefaultChatTransport<UIMessage>>[0] = {}) {
        // Own the transport's `fetch` so every request goes through stream→batch negotiation;
        // any caller-supplied fetch becomes the negotiator's base (tests inject one here).
        super({...options, fetch: undefined})
        this.negotiator = createNegotiatingFetch(options.fetch)
        this.fetch = this.negotiator.fetch
    }

    protected processResponseStream(stream: ReadableStream<Uint8Array>): ReadableStream<AnyChunk> {
        // Parse by the channel the request actually resolved to, not the requested one — a stream
        // request can come back as a batch via the 406 fallback. The mode is keyed off this exact
        // body stream (`resolvedMode(stream)`), so request and parse stay in lockstep.
        if (this.negotiator.resolvedMode(stream) === "batch")
            return batchJsonToUiMessageStream(stream)
        // Live stream: smooth coarse backend deltas into word-paced pieces (typing feel).
        return smoothTextStream(super.processResponseStream(stream))
    }
}
