/**
 * Client-tool handler registry (#4920, interaction kinds M1).
 *
 * Dispatch precedence is **`render.kind` → `toolName` → generic fallback**. `render.kind` is a
 * REQUIRED wire field for interaction kinds — it arrives as a sibling `data-render` part (AI SDK
 * tool chunks are strict), resolved into `meta.renderKind` via the message-scoped render map
 * (@agenta/playground `buildRenderMap`). The `toolName` axis is the safety net for a hint that
 * never arrived — the connect widget's v1 wire predates the guarantee, and a transcript persisted
 * before the replay path carried the sibling part has none. Each later kind is one added entry,
 * not a protocol change. Contract: docs/design/agent-chat-interaction-kinds/decisions.md
 *
 * The store itself lives in @agenta/chat/skin (`registerChatSkin`); this module registers the
 * DESKTOP skin's widgets at import time and re-exports the shared resolvers under the names the
 * slice always used. A streamed client tool with no entry is NOT an error — `ClientToolPart`
 * renders the neutral "not handled by this client" surface, which settles a non-error output so
 * the run never hangs.
 */
import {hasClientToolWidget, registerChatSkin, resolveClientToolWidget} from "@agenta/chat/skin"
import type {ClientToolMeta, ClientToolWidgetProps} from "@agenta/chat/skin"

import {CLIENT_TOOL_DESCRIPTORS} from "@agenta/shared/clientTools"

import ConnectToolWidget from "./ConnectToolWidget"
import ElicitationWidget from "./ElicitationWidget"

registerChatSkin({
    clientTools: {
        // Keyed by `render.kind` (checked first — the finer dispatch axis).
        byRenderKind: {
            connect: ConnectToolWidget,
            elicitation: ElicitationWidget,
        },
        // Keyed by `toolName` (checked when no render hint matched). Both entries are
        // platform-reserved static tools, so the name is a safe second axis when the hint is
        // missing — an old persisted transcript, or any replay path that didn't carry the
        // sibling part.
        byToolName: {
            request_connection: ConnectToolWidget,
            request_input: ElicitationWidget,
        },
    },
})

type ClientToolHandler = React.ComponentType<ClientToolWidgetProps>

/** Resolve the widget for a client tool, or `null` when none is registered. */
export const resolveClientToolHandler = (meta: ClientToolMeta): ClientToolHandler | null =>
    resolveClientToolWidget(meta) ?? null

/** Whether this client tool has a dedicated widget (used to route known tools in every state). */
export const hasClientToolHandler = (meta: ClientToolMeta): boolean => hasClientToolWidget(meta)
