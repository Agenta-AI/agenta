/**
 * Client-tool handler registry (#4920).
 *
 * Dispatch precedence is **`render.kind` → `toolName` → generic fallback** (design §"Where dispatch
 * lives"). v1 ships exactly one real entry, `request_connection` (the connect widget), keyed by both
 * its `render.kind` (`connect`) and its `toolName` so it dispatches whether or not the render hint
 * reaches the browser (verify-first seam #1: for v1 we dispatch by `toolName`). Each later client
 * tool is one added entry, not a protocol change.
 *
 * A streamed client tool with no entry is NOT an error here — `ClientToolPart` renders the explicit
 * "this app can't handle that request" surface and settles the part so the run never hangs.
 */
import type {ComponentType} from "react"

import ConnectToolWidget from "./ConnectToolWidget"
import type {ClientToolHandlerProps, ClientToolMeta} from "./types"

type ClientToolHandler = ComponentType<ClientToolHandlerProps>

/** Handlers keyed by `render.kind` (checked first — the finer dispatch axis). */
const BY_RENDER_KIND: Record<string, ClientToolHandler> = {
    connect: ConnectToolWidget,
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
