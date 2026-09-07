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
import type {ClientToolWidget} from "@agenta/shared/clientTools"

/**
 * The client-tool widget contract is DEFINED in @agenta/shared/clientTools and re-exported here, so
 * that hosts and skins keep one import site (`@agenta/chat/skin`) while the widget package
 * (@agenta/entity-ui) can reach the same types without depending on @agenta/chat. The dispatcher
 * here already imports those widgets by value; a dependency back the other way is a workspace
 * package cycle, which pnpm materializes as an endless node_modules symlink chain and which sends
 * the production webpack build into a non-terminating directory walk. See
 * `web/packages/agenta-shared/tests/unit/workspaceGraph.test.ts`.
 */
export type {
    ClientToolMeta,
    ClientToolWidget,
    ClientToolWidgetProps,
    SettleClientTool,
} from "@agenta/shared/clientTools"

/** One readable row behind the approval card's "See what changes" toggle. */
export interface ApprovalPreviewItem {
    /** Short noun phrase naming the change, e.g. `New skill · deslope`. */
    title: string
    /** One sentence saying what it means for the user. */
    detail?: string
}

/**
 * What the approval card renders — plain language, no payload. One shell serves every tool and
 * every host, so a describer returns DATA, never JSX: there is no mode in which the card shows
 * raw arguments, a diff, or a digest.
 */
export interface ApprovalPreview {
    /** One sentence: what happens if you approve, and what it costs. */
    sentence: string
    /** The rows behind the toggle. Empty hides the toggle entirely. */
    items: ApprovalPreviewItem[]
    /** Integration slug the card looks up, then re-describes with `appName`. */
    sourceKey?: string
}

/**
 * One approval registry entry: a pure function from the gate's payload to what the card says.
 * Returning `null` falls back to the generic describer, so a describer that cannot read its own
 * payload degrades instead of guessing.
 *
 * `appName` is the catalog name, which answers late: resolve once, report `sourceKey`, get called
 * again with the name. Same contract as `resolveToolDisplay`.
 */
export type ApprovalDescriber = (
    input: unknown,
    manifest: unknown,
    appName?: string,
) => ApprovalPreview | null

/** Best-effort tool family, inferred from the wire-name shape and the call's arguments. */
export type ToolKind = "gateway" | "mcp" | "platform" | "shell" | "file"

/** The row's sentence in both tenses. The done form says what was attempted, not that it worked. */
export interface ToolActivity {
    running: string
    done: string
}

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
    /** The row's sentence. A function when it names an app: it gets the real name, or undefined
     * until the catalog answers. */
    activity?: ToolActivity | ((appName?: string) => ToolActivity)
    /** The app this call is about, read from its own arguments or result. `action` is the gateway
     * ACTION token of a tool this one merely reported. */
    app?: (input: unknown, output: unknown) => {slug?: string; action?: string}
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
    /** A tool-catalog integration slug ("github"); look it up for the app's real spelling. */
    sourceKey?: string
    raw: string
    kind: ToolKind
    /** Plain-English sentence for the activity row. Falls back to `label` when none is known. */
    activity: ToolActivity
    /** Short technical detail for the row's secondary slot (a command, a filename). */
    detail?: string
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
    /** Tool name → the describer that turns its payload into the card's plain-English copy. */
    approvals?: Record<string, ApprovalDescriber>
    /** Raw tool name → display override (mirrors OSS `BY_TOOL_NAME`). */
    toolDisplay?: Record<string, ToolDisplayEntry>
}
