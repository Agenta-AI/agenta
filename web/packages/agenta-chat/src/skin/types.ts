/**
 * Skin registration shapes (WP3a-C5).
 *
 * Generalized from the three OSS chat registries — clientTools, approvals, toolDisplay (see
 * `web/oss/src/components/AgentChatSlice/components/clientTools/{registry.tsx,types.ts}`,
 * `.../components/approvals/registry.tsx`, `.../assets/toolDisplay.ts`) — with `Handler`/`Renderer`
 * renamed to `Widget`/`Entry` and no OSS import (this package never imports from `web/oss`). The
 * OSS registries keep running standalone until the desktop re-plumb PR switches them onto this
 * store; until then `registerChatSkin` (./registry.ts) is called by nobody and the store stays
 * empty — skins (mobile shadcn first) populate it.
 */
import type {ComponentType, ReactNode} from "react"

import type {ToolUIPart} from "ai"

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
    /** An earlier part in this turn already auto-settled as a degradation; the widget should park
     * (visible notice, no auto-settle) instead of looping. */
    degradedEarlierInTurn?: boolean
}

/**
 * What the OSS clientTools registry actually stores per entry: a bare component (see
 * `BY_RENDER_KIND`/`BY_TOOL_NAME` in `clientTools/registry.tsx`, both
 * `Record<string, ComponentType<ClientToolHandlerProps>>` — no separate per-entry metadata; "meta"
 * only exists as the `meta: ClientToolMeta` prop the component receives, captured above in
 * `ClientToolWidgetProps`).
 */
export type ClientToolWidget = ComponentType<ClientToolWidgetProps>

/** Props an approval body receives — mirrors OSS `ApprovalBodyProps`. */
export interface ApprovalBodyProps {
    /** The exact tool input the user is approving. */
    input: unknown
    /** Selected agent revision — specialized bodies diff payloads against its committed config. */
    entityId: string
    /** The dock's generic payload block — render it verbatim when the payload can't be previewed. */
    fallback: ReactNode
}

/**
 * One approval registry entry — mirrors OSS `ApprovalRenderer` (`approvals/registry.tsx`) field for
 * field: a `Body` plus the two copy overrides the OSS registry actually has. It has no `summary` or
 * other fields; do not add any without a corresponding OSS field to mirror.
 */
export interface ApprovalBodyEntry {
    Body: ComponentType<ApprovalBodyProps>
    /** Replaces "The agent wants to run this tool before it can keep going."; null = Body owns it. */
    headline?: string | null
    approveLabel?: string
}

/** Best-effort tool family, inferred from the wire-name shape only — mirrors OSS `ToolKind`. */
export type ToolKind = "gateway" | "mcp" | "platform"

/**
 * One toolDisplay registry entry — mirrors the *registration-time* shape OSS actually stores in its
 * `BY_TOOL_NAME` map (`toolDisplay.ts`'s unexported `ToolDisplayOverride`: `{label?; source?;
 * summary?}`), generalized with an optional `kind` override since a skin registration is not
 * required to restate `raw` (it IS the record key in `ChatSkinRegistration.toolDisplay`) or force a
 * default's inferred `kind`. All fields are optional: an entry may override just one piece (OSS's
 * `commit_revision` entry, for example, overrides only `summary`) and the resolver fills the rest
 * from the parsed name shape (see `resolveToolDisplay` in `./registry.ts`).
 */
export interface ToolDisplayEntry {
    /** Humanized action label ("Fetch emails"); overrides the parsed default when present. */
    label?: string
    /** Where the tool comes from ("Gmail", "Linear · MCP"); overrides the parsed default. */
    source?: string
    kind?: ToolKind
    /** Friendly one-liner for a settled row; null/absent falls back to the generic summary. */
    summary?: (input: unknown, output: unknown) => string | null
}

/**
 * A resolved toolDisplay — the full shape `resolveToolDisplay` returns, mirroring OSS's public
 * `ToolDisplay` interface (`raw`/`kind`/`label` always present; `source`/`summary` still optional).
 */
export interface ResolvedToolDisplay {
    label: string
    source?: string
    raw: string
    kind: ToolKind
    summary?: (input: unknown, output: unknown) => string | null
}

/**
 * Everything one skin contributes to the shared chat registries. Mirrors the OSS two-level
 * clientTools split (a render-kind map checked first, then a tool-name map — see
 * `resolveClientToolHandler`'s precedence in `clientTools/registry.tsx`) rather than inventing a
 * different nesting.
 */
export interface ChatSkinRegistration {
    clientTools?: {
        /** Checked first — the finer dispatch axis (mirrors OSS `BY_RENDER_KIND`). */
        byRenderKind?: Record<string, ClientToolWidget>
        /** Checked when no render-kind hint matched (mirrors OSS `BY_TOOL_NAME`). */
        byToolName?: Record<string, ClientToolWidget>
    }
    /** Tool name → approval body renderer + copy overrides (mirrors OSS `BY_TOOL_NAME`). */
    approvals?: Record<string, ApprovalBodyEntry>
    /** Raw tool name → display override (mirrors OSS `BY_TOOL_NAME`). */
    toolDisplay?: Record<string, ToolDisplayEntry>
}
