// Canonical since the desktop re-plumb: the OSS copy is deleted and both apps import this.
import {
    createNegotiatingFetch,
    SHARED_SESSION_RESPONSE_HEADER,
    type NegotiatingFetch,
} from "@agenta/playground/agent-chat"
import {generateId} from "@agenta/shared/utils"
import {DefaultChatTransport, type UIMessage, type UIMessageChunk} from "ai"

import {installStreamTraceHelper, traceStreamChunks} from "./streamTrace"

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

export const SHARED_SENDER_ACCEPTANCE_TIMEOUT_MS = 15_000

type AgentChatTransportOptions = NonNullable<
    ConstructorParameters<typeof DefaultChatTransport<UIMessage>>[0]
> & {
    /** Test seam; production uses `SHARED_SENDER_ACCEPTANCE_TIMEOUT_MS`. */
    sharedAcceptanceTimeoutMs?: number
}

interface SharedAcceptanceDeadline {
    signal: AbortSignal
    failure: Promise<never>
    accept: () => void
    fail: (error: Error) => void
    dispose: () => void
    onFailure: (listener: (error: Error) => void) => () => void
}

const sharedAcceptanceFailure = (): TypeError => new TypeError("Failed to fetch")

const createSharedAcceptanceDeadline = (
    parentSignal: AbortSignal | null | undefined,
    timeoutMs: number,
): SharedAcceptanceDeadline => {
    const controller = new AbortController()
    const listeners = new Set<(error: Error) => void>()
    let state: "pending" | "accepted" | "disposed" = "pending"
    let rejectFailure: (error: Error) => void = () => undefined
    const failure = new Promise<never>((_resolve, reject) => {
        rejectFailure = reject
    })
    const timer = setTimeout(() => fail(sharedAcceptanceFailure()), timeoutMs)

    const abortFromParent = () => {
        const reason =
            parentSignal?.reason instanceof Error
                ? parentSignal.reason
                : new DOMException("This operation was aborted", "AbortError")
        if (!controller.signal.aborted) controller.abort(reason)
        rejectFailure(reason)
        for (const listener of listeners) listener(reason)
        dispose()
    }

    function accept() {
        if (state !== "pending") return
        state = "accepted"
        clearTimeout(timer)
    }

    function fail(error: Error) {
        if (state !== "pending") return
        state = "disposed"
        clearTimeout(timer)
        if (!controller.signal.aborted) controller.abort(error)
        rejectFailure(error)
        for (const listener of listeners) listener(error)
        parentSignal?.removeEventListener("abort", abortFromParent)
    }

    function dispose() {
        if (state === "disposed") return
        state = "disposed"
        clearTimeout(timer)
        listeners.clear()
        parentSignal?.removeEventListener("abort", abortFromParent)
    }

    if (parentSignal?.aborted) abortFromParent()
    else parentSignal?.addEventListener("abort", abortFromParent, {once: true})

    return {
        signal: controller.signal,
        failure,
        accept,
        fail,
        dispose,
        onFailure: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}

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

const sharedAcceptanceChunk = (chunk: AnyChunk): AnyChunk | undefined => {
    if (chunk.type === "start" || chunk.type === "finish") {
        return {
            ...chunk,
            messageMetadata: {
                ...((chunk as {messageMetadata?: Record<string, unknown>}).messageMetadata ?? {}),
                sharedSender: true,
            },
        } as AnyChunk
    }
    if (
        chunk.type === "start-step" ||
        chunk.type === "finish-step" ||
        chunk.type === "error" ||
        chunk.type === "data-agent-error" ||
        chunk.type === "data-session-accepted"
    )
        return chunk
    return undefined
}

/** Consume the invoke stream without letting its content become a second rendering source. */
export const sharedAcceptanceStream = (
    stream: ReadableStream<AnyChunk>,
    deadline?: SharedAcceptanceDeadline,
): ReadableStream<AnyChunk> => {
    if (!deadline) {
        return stream.pipeThrough(
            new TransformStream<AnyChunk, AnyChunk>({
                transform(chunk, controller) {
                    const accepted = sharedAcceptanceChunk(chunk)
                    if (accepted) controller.enqueue(accepted)
                },
            }),
        )
    }

    const reader = stream.getReader()
    let closed = false
    let accepted = false
    let unsubscribe: () => void = () => undefined

    return new ReadableStream<AnyChunk>({
        start(controller) {
            unsubscribe = deadline.onFailure((error) => {
                if (closed) return
                closed = true
                controller.error(error)
                void reader.cancel(error).catch(() => undefined)
            })
        },
        async pull(controller) {
            try {
                while (!closed) {
                    const next = await reader.read()
                    if (closed) return
                    if (next.done) {
                        if (!accepted) {
                            deadline.fail(sharedAcceptanceFailure())
                            return
                        }
                        closed = true
                        unsubscribe()
                        deadline.dispose()
                        controller.close()
                        return
                    }
                    if (next.value.type === "data-session-accepted") {
                        accepted = true
                        deadline.accept()
                    }
                    const chunk = sharedAcceptanceChunk(next.value)
                    if (chunk) {
                        controller.enqueue(chunk)
                        return
                    }
                }
            } catch (error) {
                if (closed) return
                closed = true
                unsubscribe()
                deadline.dispose()
                controller.error(error)
            }
        },
        cancel(reason) {
            closed = true
            unsubscribe()
            deadline.dispose()
            return reader.cancel(reason)
        },
    })
}

export class AgentChatTransport extends DefaultChatTransport<UIMessage> {
    private readonly negotiator: NegotiatingFetch
    private readonly sharedResponses = new WeakMap<
        ReadableStream<Uint8Array>,
        SharedAcceptanceDeadline
    >()

    constructor(options: AgentChatTransportOptions = {}) {
        const {
            sharedAcceptanceTimeoutMs = SHARED_SENDER_ACCEPTANCE_TIMEOUT_MS,
            ...transportOptions
        } = options
        // Own the transport's `fetch` so every request goes through stream→batch negotiation;
        // any caller-supplied fetch becomes the negotiator's base (tests inject one here).
        super({...transportOptions, fetch: undefined})
        this.negotiator = createNegotiatingFetch(transportOptions.fetch)
        this.fetch = async (input, init) => {
            const shared =
                new Headers(init?.headers).get(SHARED_SESSION_RESPONSE_HEADER) === "shared"
            if (!shared) return this.negotiator.fetch(input, init)

            const deadline = createSharedAcceptanceDeadline(init?.signal, sharedAcceptanceTimeoutMs)
            try {
                const response = await Promise.race([
                    this.negotiator.fetch(input, {...init, signal: deadline.signal}),
                    deadline.failure,
                ])
                if (!response.ok || !response.body) {
                    deadline.dispose()
                    return response
                }
                this.sharedResponses.set(response.body, deadline)
                return response
            } catch (error) {
                deadline.dispose()
                throw error
            }
        }
    }

    protected processResponseStream(stream: ReadableStream<Uint8Array>): ReadableStream<AnyChunk> {
        // Parse by the channel the request actually resolved to, not the requested one — a stream
        // request can come back as a batch via the 406 fallback. The mode is keyed off this exact
        // body stream (`resolvedMode(stream)`), so request and parse stay in lockstep.
        const parsed =
            this.negotiator.resolvedMode(stream) === "batch"
                ? batchJsonToUiMessageStream(stream)
                : super.processResponseStream(stream)
        const sharedDeadline = this.sharedResponses.get(stream)
        if (sharedDeadline) return sharedAcceptanceStream(parsed, sharedDeadline)
        if (this.negotiator.resolvedMode(stream) === "batch") return parsed
        // Deltas pass through untouched: typing cadence is paced at paint by `useTypewriter`.
        // The trace only timestamps them — see `streamTrace.ts` for why the cadence is measured.
        installStreamTraceHelper()
        return traceStreamChunks(parsed)
    }
}
