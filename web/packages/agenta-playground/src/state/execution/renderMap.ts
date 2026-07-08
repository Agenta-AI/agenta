/**
 * Render-hint map — the receive half of the `render.kind` wire guarantee (interaction kinds).
 *
 * AI SDK tool chunks are strict objects, so the SDK's Vercel adapter carries the agenta render
 * hint as a SIBLING part: `{type: "data-render", data: {toolCallId, render}}` (persistent, so it
 * replays). Nothing attaches it to the tool part automatically — consumers build this map from a
 * message's parts and look hints up by `toolCallId`. Consulted by the resume predicate
 * (`agentApprovalResume`) and the app-layer client-tool registry dispatch.
 * Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 */

export interface RenderHintLike {
    kind?: unknown
    [key: string]: unknown
}

interface PartLike {
    type?: string
    data?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** Build `toolCallId → render` from a message's parts. Later parts win (re-emissions refresh). */
export function buildRenderMap(
    parts: readonly PartLike[] | undefined,
): Map<string, RenderHintLike> {
    const map = new Map<string, RenderHintLike>()
    for (const part of parts ?? []) {
        if (part?.type !== "data-render" || !isRecord(part.data)) continue
        const {toolCallId, render} = part.data
        if (typeof toolCallId !== "string" || toolCallId === "" || !isRecord(render)) continue
        map.set(toolCallId, render as RenderHintLike)
    }
    return map
}

/**
 * Resolve a tool part's render kind: an inline `render.kind` (future SDK versions may attach it
 * directly) wins over the sibling-part map. Returns undefined when neither carries a string kind.
 */
export function renderKindFor(
    part: {toolCallId?: string; render?: {kind?: unknown}},
    renderMap?: Map<string, RenderHintLike>,
): string | undefined {
    if (typeof part.render?.kind === "string") return part.render.kind
    const mapped = part.toolCallId ? renderMap?.get(part.toolCallId)?.kind : undefined
    return typeof mapped === "string" ? mapped : undefined
}
