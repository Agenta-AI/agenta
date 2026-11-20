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
 * The server's dry run of a versioned agent change (`edit_agent_config`, `create_agent`): the
 * change-set engine applied to the call's base revision, nothing saved. It reaches the browser
 * as the stream part `data-approval-preview` (`{toolCallId, approvalId, preview}`). Values are
 * bounded (4 KB each, a diff 16 KB, the whole preview 64 KB); past the bound a change keeps only
 * `path`, `operation_indexes` and `kind`, and `truncated` is set.
 */
export interface ChangePreview {
    /** The whole change set applies to the base. */
    applies: boolean
    base?: {id: string; version: string | number}
    /** Each operation's status; `applies: null` = not checked (the engine stopped before it). */
    operations: {index: number; applies: boolean | null; error?: ChangePreviewError}[]
    /** Empty when the change set cannot apply. */
    changes: ChangePreviewChange[]
    truncated?: boolean
    /** The engine refused the change set as a whole (no operation index). */
    error?: ChangePreviewError
}

export interface ChangePreviewError {
    code: string
    message: string
}

/** One changed path. A list item is addressed by `{list, key}` in `path`. */
export interface ChangePreviewChange {
    path: unknown[]
    operation_indexes: number[]
    kind: "added" | "removed" | "changed"
    old?: unknown
    new?: unknown
    /** A unified diff, for text over 400 characters. */
    diff?: string
    truncated?: boolean
}

/** Risk kinds a change can add; each shows one warning line on the card. */
export type ApprovalChangeRisk = "fewer_approvals" | "data_egress" | "cost" | "breakage"

/**
 * The detail of one change, in one of four forms. Values are display text, ready to show.
 * - `text_diff`: a text field. `old` and `new` (or `diff`) come from the server preview; with no
 *   preview, `fragmentsOnly` is set and `edits` holds the proposed fragments of `edit_text`, or
 *   `new` holds the proposed text of a `set`.
 * - `value_change`: a short value; `old` is absent when the preview is missing.
 * - `item`: a whole list item added or removed (a skill, a tool, an MCP server).
 * - `user_step`: a step the person does before the change (connect, paste a secret).
 */
export type ApprovalChangeDetail =
    | {
          kind: "text_diff"
          old?: string
          new?: string
          diff?: string
          fragmentsOnly?: boolean
          edits?: {old?: string; new?: string}[]
      }
    | {kind: "value_change"; old?: string; new?: string}
    | {kind: "item"; change: "added" | "removed"; name: string}
    | {kind: "user_step"; step: string}

/** One change a card proposes (shared contract SC6). */
export interface ApprovalChange {
    title: string
    /** Readable path segments, for example `["skills", "release-qa", "body"]`. */
    path: string[]
    /** Absent for an operation the card cannot render: it shows its title and path only. */
    detail?: ApprovalChangeDetail
    /** "version": saved as part of a new version; "immediate": applies at once. */
    effect: "version" | "immediate"
    risks: ApprovalChangeRisk[]
    /** The server preview names this operation as the one that cannot apply. */
    fails?: boolean
}

/**
 * What the approval card renders — plain language, no payload. One shell serves every tool and
 * every host, so a describer returns DATA, never JSX: there is no mode in which the card shows
 * raw arguments.
 */
export interface ApprovalPreview {
    /** One sentence: what happens if you approve, and what it costs. */
    sentence: string
    /** The rows behind the toggle. Empty hides the toggle entirely. */
    items: ApprovalPreviewItem[]
    /** Integration slug the card looks up, then re-describes with `appName`. */
    sourceKey?: string
    /** The configuration changes, for a tool that changes an agent's configuration. */
    changes?: ApprovalChange[]
    /** The changes show the proposed values: the server preview is missing for this call. */
    proposedValues?: boolean
    /** The server preview says the change set cannot apply to the current version. */
    cannotApply?: boolean
}

/**
 * One approval registry entry: a pure function from the gate's payload to what the card says.
 * Returning `null` falls back to the generic describer, so a describer that cannot read its own
 * payload degrades instead of guessing. It stays pure: old values come only from the server
 * preview the host passes, never from a fetch.
 *
 * `appName` is the catalog name, which answers late: resolve once, report `sourceKey`, get called
 * again with the name. Same contract as `resolveToolDisplay`.
 */
export type ApprovalDescriber = (
    input: unknown,
    manifest: unknown,
    appName?: string,
    /** The server preview of this call, when the gate carries one (`data-approval-preview`). */
    changePreview?: unknown,
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
    /** The sentence around its object, with `{{object}}` where the object goes; set with `verb`. */
    frame?: ToolActivity
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
