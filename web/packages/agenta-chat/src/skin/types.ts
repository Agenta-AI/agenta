/**
 * Skin registration shapes for the three chat registries — clientTools, approvals, toolDisplay.
 * Skins populate the store through `registerChatSkin` (./registry.ts).
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

/** The closed set of activity-step glyphs, chosen by kind and canonical name, never per raw tool. */
export type ActivityIcon =
    | "brain"
    | "terminal"
    | "file-read"
    | "file-write"
    | "file-list"
    | "file-search"
    | "web-search"
    | "web-fetch"
    | "subtask"
    | "agent"
    | "task-list"
    | "commit"
    | "config"
    | "rename"
    | "test"
    | "schedule"
    | "trigger"
    | "runs"
    | "annotation"
    | "deliveries"
    | "tool-search"
    | "connections"
    | "gateway"
    | "mcp"
    | "platform"
    | "ask"
    | "connect"
    | "secret"

/**
 * One toolDisplay registry entry. A skin registration is not required to restate `raw` (it IS the
 * record key in `ChatSkinRegistration.toolDisplay`) or force a default's inferred `kind`. All
 * fields are optional: an entry may override just one piece (e.g. only `summary`) and the resolver
 * fills the rest from the parsed name shape (see `resolveToolDisplay` in `./registry.ts`).
 */
export interface ToolDisplayEntry {
    /** Humanized action label ("Fetch emails"); overrides the parsed default when present. */
    label?: string
    /** Where the tool comes from ("Gmail", "Linear · MCP"); overrides the parsed default. */
    source?: string
    kind?: ToolKind
    /** The row's sentence; a function gets the app's name (undefined until known) and may decline. */
    activity?: ToolActivity | ((appName?: string) => ToolActivity | undefined)
    /** The app this call is about; `action` is a tool it reported, or with `ran`, called. */
    app?: (input: unknown, output: unknown) => {slug?: string; action?: string; ran?: boolean}
    /** Friendly one-liner for a settled row; null/absent falls back to the generic summary. */
    summary?: (input: unknown, output: unknown) => string | null
    /** The verb forms a static `activity` opens with, so a row can bold what follows. */
    verb?: ToolActivity
    /** The step glyph; overrides the kind's default. */
    icon?: ActivityIcon
}

/**
 * A resolved toolDisplay — the full shape `resolveToolDisplay` returns (`raw`/`kind`/`label`
 * always present; `source`/`summary` still optional).
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
    /** The verb alone, in both tenses, when the sentence was built from one. */
    verb?: ToolActivity
    /** The step glyph, from the override or the kind's default. */
    icon: ActivityIcon
}

/**
 * Everything one skin contributes to the shared chat registries. clientTools is two-level: a
 * render-kind map checked first, then a tool-name map.
 */
export interface ChatSkinRegistration {
    clientTools?: {
        /** Checked first — the finer dispatch axis. */
        byRenderKind?: Record<string, ClientToolWidget>
        /** Checked when no render-kind hint matched. */
        byToolName?: Record<string, ClientToolWidget>
    }
    /** Tool name → the describer that turns its payload into the card's plain-English copy. */
    approvals?: Record<string, ApprovalDescriber>
    /** Raw tool name → display override. */
    toolDisplay?: Record<string, ToolDisplayEntry>
    /** Connected integration slugs: a bare tool name carrying one (`list-devto-articles`) is that app's. */
    appHints?: string[]
}
