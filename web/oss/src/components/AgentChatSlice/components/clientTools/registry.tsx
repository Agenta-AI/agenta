/**
 * Client-tool handler registry (#4920, interaction kinds M1).
 *
 * Dispatch precedence is **`render.kind` → `toolName` → generic fallback**. `render.kind` is a
 * REQUIRED wire field for interaction kinds — it arrives as a sibling `data-render` part (AI SDK
 * tool chunks are strict), resolved into `meta.renderKind` via the message-scoped render map
 * (@agenta/playground `buildRenderMap`). The `toolName` axis remains for the shipped connect
 * widget, whose v1 wire predates the guarantee. Each later kind is one added entry, not a
 * protocol change. Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 *
 *   runner interaction_request ──▶ tool part (+ sibling data-render part)
 *                                        │ AgentMessage: buildRenderMap(message.parts)
 *                                        ▼
 *                    ClientToolPart → resolveClientToolHandler(meta)
 *                    render.kind ──▶ BY_RENDER_KIND   (elicitation, connect, …)
 *                    toolName ─────▶ BY_TOOL_NAME     (request_connection)
 *                    neither ──────▶ UnhandledClientTool ("can't handle", auto-settles)
 *                                        │ widget settles: output {action,…} | errorText
 *                                        ▼
 *                    addToolOutput → agentShouldResumeAfterApproval → auto-resend → resume
 *
 * A streamed client tool with no entry is NOT an error here — `ClientToolPart` renders the explicit
 * "this app can't handle that request" surface and settles the part so the run never hangs. An
 * `elicitation` part whose payload fails validation degrades the same way (errorText, retry-capped).
 */
import type {ComponentType} from "react"

import ConnectToolWidget from "./ConnectToolWidget"
import ElicitationWidget from "./ElicitationWidget"
import type {ClientToolHandlerProps, ClientToolMeta} from "./types"

type ClientToolHandler = ComponentType<ClientToolHandlerProps>

/** Handlers keyed by `render.kind` (checked first — the finer dispatch axis). */
const BY_RENDER_KIND: Record<string, ClientToolHandler> = {
    connect: ConnectToolWidget,
    elicitation: ElicitationWidget,
}

/** Handlers keyed by `toolName` (checked when no render hint matched). */
const BY_TOOL_NAME: Record<string, ClientToolHandler> = {
    request_connection: ConnectToolWidget,
}

/** Resolve the widget for a client tool, or `null` when none is registered. */
export const resolveClientToolHandler = (meta: ClientToolMeta): ClientToolHandler | null => {
    if (meta.renderKind && BY_RENDER_KIND[meta.renderKind]) return BY_RENDER_KIND[meta.renderKind]
    if (BY_TOOL_NAME[meta.toolName]) return BY_TOOL_NAME[meta.toolName]
    return null
}

/** Whether this client tool has a dedicated widget (used to route known tools in every state). */
export const hasClientToolHandler = (meta: ClientToolMeta): boolean =>
    resolveClientToolHandler(meta) !== null
