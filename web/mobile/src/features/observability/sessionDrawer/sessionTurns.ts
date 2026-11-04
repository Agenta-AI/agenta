import {filterTree, type TraceSpanNode} from "@agenta/observability"

/** One line of a trace read as a conversation: who said it, and the text. */
export interface TurnMessage {
    role: string
    content: string
}

/** The totals the "Summary" row and the tree root show. */
export interface SessionStats {
    cost: number
    tokens: number
    /** Milliseconds, summed over the traces. */
    latency: number
    /** Each model once, in the order the traces name them. */
    models: string[]
}

/** The tree keeps a trace collapsed unless it says otherwise. */
export type SessionTreeNode = TraceSpanNode & {expanded?: boolean}

/** What a `?span=` on the link points at. */
export type SessionSpanTarget =
    | {kind: "trace"; spanId: string}
    | {kind: "span"; traceId: string; spanId: string}

export const SESSION_TREE_ROOT_KEY = "root"

/** The page id of a trace's panel, which the tree scrolls to. */
export const sessionTraceAnchorId = (spanId: string): string => `session-trace-${spanId}`

const GENERATOR_REPR = /^<(?:async_)?generator object/
const EXCEPTION_FALLBACK = "An error occurred during the session execution."

type LooseRecord = Record<string, unknown>

const isRecord = (value: unknown): value is LooseRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const childrenOf = (node: TraceSpanNode): TraceSpanNode[] =>
    (node.children ?? []) as TraceSpanNode[]

const readPath = (source: unknown, path: string[]): unknown =>
    path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source)

const readNumber = (source: unknown, path: string[]): number => {
    const value = readPath(source, path)
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

const toText = (content: unknown): string => {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content
    try {
        return JSON.stringify(content) ?? String(content)
    } catch {
        return String(content)
    }
}

const toMessages = (items: unknown[], fallbackRole: string): TurnMessage[] =>
    items.map((item) =>
        isRecord(item)
            ? {
                  role: typeof item.role === "string" ? item.role : fallbackRole,
                  content: toText(item.content),
              }
            : {role: fallbackRole, content: toText(item)},
    )

/** The data a span carries: the node's own field, else the same field under `ag.data`. */
const spanData = (node: TraceSpanNode, field: "inputs" | "outputs"): unknown => {
    const loose: LooseRecord = {...node}
    return loose[field] ?? readPath(node.attributes, ["ag", "data", field])
}

/**
 * A streamed agent run's root span returns a generator, so its outputs read
 * `<async_generator object ...>` and not the reply: the span closes before the stream produces
 * text. The reply lives on the nested agent span. Prefer that one and ignore a generator repr.
 */
const outputsOf = (trace: TraceSpanNode): unknown => {
    const findAgentOutput = (node: TraceSpanNode): unknown => {
        if (node.span_type === "agent") {
            const out = spanData(node, "outputs")
            if (out !== undefined && out !== null) return out
        }
        for (const child of childrenOf(node)) {
            const found = findAgentOutput(child)
            if (found !== undefined) return found
        }
        return undefined
    }
    const fromAgent = findAgentOutput(trace)
    if (fromAgent !== undefined) return fromAgent
    const root = spanData(trace, "outputs")
    return typeof root === "string" && GENERATOR_REPR.test(root) ? undefined : root
}

/** Reads a trace as messages: its inputs, then its outputs, then the error if it failed. */
export const extractTurnMessages = (trace: TraceSpanNode): TurnMessage[] => {
    const inputs = spanData(trace, "inputs")
    const outputs = outputsOf(trace)
    const messages: TurnMessage[] = []

    if (inputs !== null && inputs !== undefined) {
        if (isRecord(inputs) && Array.isArray(inputs.messages)) {
            messages.push(...toMessages(inputs.messages, "user"))
        } else if (isRecord(inputs) && Array.isArray(inputs.prompt)) {
            messages.push(...toMessages(inputs.prompt, "user"))
        } else {
            const content = isRecord(inputs) ? (inputs.message ?? inputs.input ?? inputs) : inputs
            messages.push({role: "user", content: toText(content)})
        }
    }

    if (outputs !== null && outputs !== undefined) {
        if (typeof outputs === "string") {
            messages.push({role: "assistant", content: outputs})
        } else if (isRecord(outputs) && Array.isArray(outputs.completion)) {
            messages.push(...toMessages(outputs.completion, "assistant"))
        } else if (isRecord(outputs) && outputs.role && outputs.content !== undefined) {
            messages.push({role: toText(outputs.role), content: toText(outputs.content)})
        } else {
            const content = isRecord(outputs)
                ? (outputs.message ?? outputs.output ?? outputs)
                : outputs
            messages.push({role: "assistant", content: toText(content)})
        }
    }

    if (trace.status_code === "STATUS_CODE_ERROR") {
        messages.push({role: "exception", content: trace.status_message || EXCEPTION_FALLBACK})
    }

    return messages
}

const startOf = (trace: TraceSpanNode): number => {
    const time = trace.start_time == null ? NaN : new Date(trace.start_time).getTime()
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

/** Oldest first. A trace with no start time goes last. */
export const sortTracesByStart = (traces: TraceSpanNode[]): TraceSpanNode[] =>
    [...traces].sort((a, b) => startOf(a) - startOf(b))

/**
 * From the second trace on, the messages before the last user message repeat the earlier turns,
 * so the panel hides them. Returns how many.
 */
export const hiddenMessageCount = (messages: TurnMessage[], traceIndex: number): number => {
    if (traceIndex === 0) return 0
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return i
    }
    return 0
}

/** What one trace reports about itself: milliseconds, tokens and dollars. */
export interface TraceMetrics {
    durationMs: number
    totalTokens: number
    totalCost: number
}

export const readTraceMetrics = (trace: TraceSpanNode): TraceMetrics => ({
    durationMs: readNumber(trace.attributes, ["ag", "metrics", "duration", "cumulative"]),
    totalTokens: readNumber(trace.attributes, ["ag", "metrics", "tokens", "cumulative", "total"]),
    totalCost: readNumber(trace.attributes, ["ag", "metrics", "costs", "cumulative", "total"]),
})

/** Cost, tokens and latency are summed once per trace. Each model is listed once. */
export const buildSessionStats = (traces: TraceSpanNode[]): SessionStats | null => {
    if (traces.length === 0) return null
    const models: string[] = []
    let cost = 0
    let tokens = 0
    let latency = 0
    for (const trace of traces) {
        const metrics = readTraceMetrics(trace)
        cost += metrics.totalCost
        tokens += metrics.totalTokens
        latency += metrics.durationMs
        const model = readPath(trace.attributes, [
            "ag",
            "data",
            "parameters",
            "prompt",
            "llm_config",
            "model",
        ])
        if (typeof model === "string" && model !== "" && !models.includes(model)) models.push(model)
    }
    return {cost, tokens, latency, models}
}

/** Finds out whether a span id names a trace root or a span inside a trace. */
export const findSpanInSession = (
    traces: TraceSpanNode[],
    spanId: string,
): SessionSpanTarget | null => {
    const contains = (node: TraceSpanNode): boolean =>
        node.span_id === spanId || childrenOf(node).some(contains)
    for (const trace of traces) {
        if (trace.span_id === spanId) return {kind: "trace", spanId}
        if (contains(trace)) return {kind: "span", traceId: trace.trace_id, spanId}
    }
    return null
}

/**
 * The tree the left column shows: a "Session" root over one "Trace n" node per trace, oldest
 * first. The root carries the totals in the same shape a real span does, so the packaged row
 * formats them. A search keeps the matching branches, or the whole tree when nothing matches.
 */
export const buildSessionTree = (
    sortedTraces: TraceSpanNode[],
    stats: SessionStats | null,
    search: string,
): SessionTreeNode | undefined => {
    if (sortedTraces.length === 0) return undefined
    const turns: SessionTreeNode[] = sortedTraces.map((trace, index) => ({
        ...trace,
        span_name: `Trace ${index + 1}`,
        expanded: false,
    }))
    const root: SessionTreeNode = {
        trace_id: "",
        span_id: SESSION_TREE_ROOT_KEY,
        span_name: "Session",
        children: turns,
        attributes: {
            ag: {
                metrics: {
                    tokens: {cumulative: {total: stats?.tokens ?? 0}},
                    costs: {cumulative: {total: stats?.cost ?? 0}},
                    duration: {cumulative: stats?.latency ?? 0},
                },
            },
        },
        expanded: true,
    }
    if (!search.trim()) return root
    return (filterTree(root, search) as SessionTreeNode | undefined) ?? root
}
