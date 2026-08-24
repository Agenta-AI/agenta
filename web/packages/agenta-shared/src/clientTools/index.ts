/**
 * The client-tool contract (#4920): the descriptors both halves key off, and the prop shape a
 * widget receives.
 *
 * The WIDGET types live in this leaf package, not beside the dispatcher in @agenta/chat, because
 * the dispatcher reaches the widgets in @agenta/entity-ui by VALUE. If the widget package also
 * needed @agenta/chat for these types, the two packages would depend on each other, pnpm would
 * materialize that as an endless symlink chain in node_modules, and webpack's context-directory
 * hashing would walk it forever (see the note on `@agenta/chat` in this package's README-level
 * layering rule, and the workspace-graph contract test in tests/unit/workspaceGraph.test.ts).
 * @agenta/chat re-exports every type below from `@agenta/chat/skin`, so hosts and skins keep
 * importing them from there.
 */
import type {ComponentType} from "react"

import type {ToolUIPart} from "ai"

export const CLIENT_TOOL_DESCRIPTORS = {
    connection: {toolName: "request_connection", renderKind: "connect"},
    elicitation: {toolName: "request_input", renderKind: "elicitation"},
} as const

export const CLIENT_TOOL_NAMES: ReadonlySet<string> = new Set(
    Object.values(CLIENT_TOOL_DESCRIPTORS).map(({toolName}) => toolName),
)

const CLIENT_TOOL_INTERACTION_ENDED_KEY = "agenta_interaction_ended"

// Marks a terminal row with no saved answer, which is neither an answer nor an abandonment.
// Frozen: replay assigns it as a part's `output`, so a mutable singleton would alias every card.
export const CLIENT_TOOL_INTERACTION_ENDED_OUTPUT = Object.freeze({
    [CLIENT_TOOL_INTERACTION_ENDED_KEY]: true,
})

export function isInteractionEndedOutput(output: unknown): boolean {
    return (
        typeof output === "object" &&
        output !== null &&
        !Array.isArray(output) &&
        (output as Record<string, unknown>)[CLIENT_TOOL_INTERACTION_ENDED_KEY] === true
    )
}

/**
 * Normalised view of a tool part a client-tool widget reads, mirroring OSS's `ClientToolMeta`
 * (`clientTools/types.ts`). Structural (no `ai` dependency beyond the raw part) so a skin widget
 * and the resolvers agree on one shape.
 */
export interface ClientToolMeta {
    toolCallId: string
    toolName: string
    /** The `render.kind` hint (from a sibling `data-render` part), checked before `toolName`. */
    renderKind?: string
    state: string
    input: unknown
    output: unknown
    /** A result already settled it (`output-available`/`output-error`). */
    settled: boolean
    /** The raw part, for widgets that need fields beyond the normalised view. */
    part: ToolUIPart
}

/** Settle the parked part. Mirrors OSS `SettleClientTool`: exactly one of `output`/`errorText`. */
export interface SettleClientTool {
    (args: {output: Record<string, unknown>}): void
    (args: {errorText: string}): void
}

/** Props every client-tool widget receives — mirrors OSS `ClientToolHandlerProps`. */
export interface ClientToolWidgetProps {
    meta: ClientToolMeta
    /** Settle the part (resumes the run). No-op once already settled. */
    settle: SettleClientTool
    /**
     * Display label of the tool that parked this request ("Asked by …"), or null for a platform
     * client tool whose own chrome already says who asks. Resolved by the DISPATCHER and passed
     * down, because the tool-display store lives in @agenta/chat: a widget that resolved it itself
     * would have to import @agenta/chat back, and that is the package cycle this whole contract
     * exists to prevent.
     */
    askerLabel?: string | null
    /** An earlier part in this turn already auto-settled as a degradation; the widget should park
     * (visible notice, no auto-settle) instead of looping. */
    degradedEarlierInTurn?: boolean
}

/**
 * What the clientTools registry stores per entry: a bare component (see `byRenderKind`/`byToolName`
 * in @agenta/entity-ui's `clientTools/registry.tsx`, both `Record<string, ClientToolWidget>` — no
 * separate per-entry metadata; "meta" only exists as the `meta: ClientToolMeta` prop the component
 * receives, captured above in `ClientToolWidgetProps`).
 */
export type ClientToolWidget = ComponentType<ClientToolWidgetProps>
