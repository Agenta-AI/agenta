/**
 * Normalise a tool UI part into the {@link ClientToolMeta} the dispatcher reads, and decide whether
 * a part is a client tool the playground must fulfill (vs an ordinary server tool or an approval
 * gate, which `ToolActivity` owns).
 */
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
        // Inline hint or the message-scoped sibling `data-render` part (strict tool chunks
        // cannot carry `render` inline — see @agenta/playground buildRenderMap).
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

/**
 * Whether a tool part is a client tool the playground renders (a widget or a settled chip), rather
 * than letting it fall through to `ToolActivity`. Two ways a part qualifies:
 *
 *  1. **Known client tool** — its `render.kind`/`toolName` is in the registry. Rendered in every
 *     state so the result UX (chip) shows after it settles.
 *  2. **Parked unknown client tool** — the turn has finished (not streaming) yet a tool part the
 *     runner marked for the browser (a `render` hint, inline or on the sibling `data-render`
 *     part) is still unsettled and is not an approval gate. This host has no widget for it, so
 *     we surface the neutral "not handled" widget (which settles the part so it never hangs).
 *
 * A server tool still running when this client's stream detached (a long `test_run` across a
 * gate round-trip) looks the same from here — last message, not streaming, no output — but
 * carries no render hint. It is NOT claimed: auto-settling it would send the runner a bogus
 * "not handled" result for a call it is still executing.
 */
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
