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
 * The store and the resolvers live in @agenta/chat/skin. The dispatcher there reaches these
 * widgets by VALUE (`resolveClientToolWidget(meta, clientToolWidgets)`), and its lookup checks the
 * registered store BEFORE this fallback, so a host skin can still override any entry through
 * `registerChatSkin`. This module must NOT import @agenta/chat at all, not even for types: the
 * dispatcher's value import already points chat → entity-ui, and a dependency back the other way
 * is a workspace package cycle. pnpm materializes such a cycle as an endless symlink chain in
 * node_modules, and webpack's context-directory hashing walks it until it dies
 * (`RangeError: Invalid array length` inside `FileSystemInfo._getUnresolvedContextTsh`). The shared
 * contract in @agenta/shared/clientTools exists for exactly this reason.
 *
 * A streamed client tool with no entry is NOT an error — `ClientToolPart` renders the neutral
 * "not handled by this client" surface, which settles a non-error output so the run never hangs.
 */
import type {ClientToolWidget} from "@agenta/shared/clientTools"

import ConnectToolWidget from "./ConnectToolWidget"
import ElicitationWidget from "./ElicitationWidget"

/** The built-in client-tool widgets, as a plain value.
 *
 * Exported as a VALUE rather than registered, because registration is a module SIDE EFFECT and both
 * this package and @agenta/chat declare `sideEffects: false` — a bare `import "…/clientTools"` from
 * the dispatcher was tree-shaken away, the registry stayed empty, and every elicitation silently
 * auto-settled as "not handled by this client". A value import cannot be shaken.
 */
export const clientToolWidgets: {
    byRenderKind: Record<string, ClientToolWidget>
    byToolName: Record<string, ClientToolWidget>
} = {
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
}
