/**
 * Normalise a tool UI part into the {@link ClientToolMeta} the dispatcher reads, and decide whether
 * a part is a client tool the playground must fulfill (vs an ordinary server tool or an approval
 * gate, which `ToolActivity` owns).
 */
import type {ToolUIPart} from "ai"

import {hasClientToolHandler} from "./registry"
import type {ClientToolMeta} from "./types"

const SETTLED = new Set(["output-available", "output-error"])
const APPROVAL = new Set(["approval-requested", "approval-responded"])

/** Friendly tool name: `tool-<name>` carries it in the type; `dynamic-tool` on `toolName`. */
export const clientToolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

/** Read the optional render hint off the part (may be absent on the wire in v1). */
const renderKindOf = (part: ToolUIPart): string | undefined => {
    const render = (part as {render?: {kind?: unknown}}).render
    return render && typeof render.kind === "string" ? render.kind : undefined
}

export const clientToolMeta = (part: ToolUIPart): ClientToolMeta => {
    const state = part.state as string
    return {
        toolCallId: part.toolCallId,
        toolName: clientToolName(part),
        renderKind: renderKindOf(part),
        state,
        input: (part as {input?: unknown}).input,
        output: (part as {output?: unknown}).output,
        settled: SETTLED.has(state),
        part,
    }
}

/**
 * Whether a tool part is a client tool the playground renders (a widget or a settled chip), rather
 * than letting it fall through to `ToolActivity`. Two ways a part qualifies:
 *
 *  1. **Known client tool** — its `render.kind`/`toolName` is in the registry. Rendered in every
 *     state so the result UX (chip) shows after it settles.
 *  2. **Parked unknown client tool** — the turn has finished (not streaming) yet a non-provider-
 *     executed tool part is still unsettled and is not an approval gate. The runner only leaves a
 *     part in this "turn done, part unsettled, not providerExecuted" state for a client tool, so we
 *     surface the explicit "can't handle that" widget (which settles the part so it never hangs).
 */
export const isClientToolPart = (
    part: ToolUIPart,
    ctx: {isStreaming: boolean; isLastMessage: boolean},
): boolean => {
    const state = part.state as string
    if (APPROVAL.has(state)) return false
    if ((part as {providerExecuted?: boolean}).providerExecuted === true) return false

    const meta = clientToolMeta(part)
    if (hasClientToolHandler(meta)) return true

    // Parked unknown client tool: the run ended with this part still unsettled.
    const parkedUnsettled = !ctx.isStreaming && ctx.isLastMessage && !meta.settled
    return parkedUnsettled
}
