import {SpanCategory, StatusCode, TraceSpanNode} from "@/oss/services/tracing/types"

/**
 * Span tree visibility modes.
 *
 * - `all`: show every span (default, original behaviour).
 * - `key`: collapse the tree down to the spans that carry real signal and hide
 *   structural/utility wrappers (chains, parsers, lambdas, ...).
 */
export type SpanVisibilityMode = "all" | "key"

export interface SpanVisibilityOption {
    value: SpanVisibilityMode
    label: string
    hint: string
}

export const SPAN_VISIBILITY_OPTIONS: SpanVisibilityOption[] = [
    {value: "all", label: "All spans", hint: "Show every span in the trace"},
    {value: "key", label: "Key spans", hint: "LLM, tool, and agent spans, plus errors"},
]

/**
 * Span categories that represent actual model/tool/retrieval work rather than
 * structural plumbing. Spans of these types are always kept by the "Key spans"
 * filter.
 *
 * This set is intentionally the main knob for tuning the filter: add or remove a
 * category here to change what counts as a key span across the whole app.
 */
export const KEY_SPAN_TYPES: ReadonlySet<SpanCategory> = new Set([
    SpanCategory.AGENT,
    SpanCategory.LLM,
    SpanCategory.CHAT,
    SpanCategory.COMPLETION,
    SpanCategory.TOOL,
    SpanCategory.EMBEDDING,
    SpanCategory.QUERY,
    SpanCategory.RERANK,
])

/**
 * Span name patterns that mark a span as meaningful even when its type is a
 * generic wrapper (e.g. LangChain reports output parsers as `chain` spans, but
 * a tool/agent output parser carries the model's tool-call decision).
 *
 * This is the second main knob: add a pattern to surface a span the type-based
 * rule would otherwise hide.
 */
export const KEY_SPAN_NAME_PATTERNS: readonly RegExp[] = [/OutputParser/i]

/**
 * A rule that decides whether a single span is relevant on its own merits.
 *
 * A span survives the "Key spans" filter when ANY rule matches it, when it is the
 * trace root, or when one of its descendants survives (so the path to a key span
 * stays intact). Add, remove, or reorder rules here to evolve the definition of a
 * key span over time — the filter logic below does not need to change.
 */
export interface KeySpanRule {
    id: string
    description: string
    test: (node: TraceSpanNode) => boolean
}

export const keySpanRules: KeySpanRule[] = [
    {
        id: "work-span-type",
        description: "Model, tool, agent, and retrieval spans",
        test: (node) => !!node.span_type && KEY_SPAN_TYPES.has(node.span_type),
    },
    {
        id: "key-name",
        description: "Spans whose name marks them as meaningful (e.g. output parsers)",
        test: (node) =>
            !!node.span_name && KEY_SPAN_NAME_PATTERNS.some((re) => re.test(node.span_name!)),
    },
    {
        id: "errored-span",
        description: "Spans that ended in an error",
        test: (node) => node.status_code === StatusCode.STATUS_CODE_ERROR,
    },
]

export const isKeySpan = (node: TraceSpanNode): boolean =>
    keySpanRules.some((rule) => rule.test(node))

export interface SpanFilterResult {
    /** Pruned tree, or null when there is no input tree. */
    tree: TraceSpanNode | null
    /** Number of spans removed from view by the filter. */
    hiddenCount: number
}

/**
 * Prune a span tree down to its key spans.
 *
 * The root is always kept so the trace stays anchored. Non-key spans are removed
 * and their surviving descendants are promoted to the nearest kept ancestor — so
 * wrapper chains (RunnableSequence, RunnableMap, ...) disappear and the key spans
 * they contain attach directly to the root, rather than being kept as scaffolding.
 */
export const filterKeySpans = (root?: TraceSpanNode): SpanFilterResult => {
    if (!root) return {tree: null, hiddenCount: 0}

    let hiddenCount = 0

    const collect = (node: TraceSpanNode, isRoot: boolean): TraceSpanNode[] => {
        const keptChildren = ((node.children as TraceSpanNode[] | undefined) || []).flatMap(
            (child) => collect(child, false),
        )

        if (isRoot || isKeySpan(node)) {
            return [{...node, children: keptChildren}]
        }

        hiddenCount += 1
        return keptChildren
    }

    const [tree] = collect(root, true)
    return {tree: tree ?? null, hiddenCount}
}
