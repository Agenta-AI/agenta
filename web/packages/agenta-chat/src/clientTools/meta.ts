// The client-tool meta the dispatcher reads, and whether a part is a client tool at all.
import {clientToolWidgets} from "@agenta/entity-ui/clientTools"
import {renderKindFor, type RenderHintLike} from "@agenta/playground/agent-chat"
import type {ToolUIPart} from "ai"

import {hasClientToolWidget, type ClientToolMeta} from "../skin"

const SETTLED = new Set(["output-available", "output-error", "output-denied"])
const APPROVAL = new Set(["approval-requested", "approval-responded"])

/** Friendly tool name: `tool-<name>` carries it in the type; `dynamic-tool` on `toolName`. */
export const clientToolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

export const clientToolMeta = (
    part: ToolUIPart,
    renderMap?: Map<string, RenderHintLike>,
): ClientToolMeta => {
    const state = part.state as string
    return {
        toolCallId: part.toolCallId,
        toolName: clientToolName(part),
        // Inline hint, or the sibling `data-render` part (see @agenta/playground buildRenderMap).
        renderKind: renderKindFor(
            part as {toolCallId?: string; render?: {kind?: unknown}},
            renderMap,
        ),
        state,
        input: (part as {input?: unknown}).input,
        output: (part as {output?: unknown}).output,
        settled: SETTLED.has(state),
        part,
    }
}

/** A client tool: registered, or parked unsettled with a render hint (a server tool still running has none). */
export const isClientToolPart = (
    part: ToolUIPart,
    ctx: {isStreaming: boolean; isLastMessage: boolean},
    renderMap?: Map<string, RenderHintLike>,
): boolean => {
    const state = part.state as string
    if (APPROVAL.has(state)) return false
    // An approval-gated part is `ToolActivity`'s: auto-settling it would erase the user's decision.
    if ((part as {approval?: unknown}).approval != null) return false
    if ((part as {providerExecuted?: boolean}).providerExecuted === true) return false

    const meta = clientToolMeta(part, renderMap)
    if (hasClientToolWidget(meta, clientToolWidgets)) return true

    // Keep this last-message-only so old parked parts are not auto-settled.
    const parkedUnsettled = !ctx.isStreaming && ctx.isLastMessage && !meta.settled
    return parkedUnsettled && meta.renderKind !== undefined
}
