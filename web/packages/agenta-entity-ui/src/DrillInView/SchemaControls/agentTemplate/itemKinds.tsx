/**
 * Per-kind registry for the tool / MCP / skill list sections. They share one machinery (an
 * {@link ItemRow} list + a draft-then-save {@link ConfigItemDrawer}) and differ only in this data —
 * config array, classifier, form view, per-kind rules — so all three run through one code path.
 */
import type {ComponentType, ReactNode} from "react"

import {GraduationCap, Plugs, Wrench} from "@phosphor-icons/react"

import type {ConfigItemView} from "../ConfigItemDrawer"
import {McpServerFormView} from "../McpServerFormView"
import {SkillFormView} from "../SkillFormView"
import {skillDraftError} from "../skillName"
import {ToolFormView} from "../ToolFormView"
import {parseGatewayEntry} from "../toolUtils"

import {
    describeMcp,
    describeSkill,
    describeSubagent,
    describeTool,
    isEmbedRefSkill,
    isFunctionTool,
    isReferenceTool,
    isStaticSkill,
    type ItemDescriptor,
} from "./itemDescriptors"

export type ItemKind = "tool" | "mcp" | "skill"

/** The structured form view for a kind — Tool/Mcp/Skill all share this prop shape. */
type ItemFormView = ComponentType<{
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
}>

export interface ItemKindDef {
    kind: ItemKind
    /** The flat config array this kind lives on. */
    field: "tools" | "mcps" | "skills"
    /** Drawer (and section) icon. */
    icon: ReactNode
    /** Noun for the collapsed-header count ("3 tools"). */
    noun: string
    /** Empty-state lead ("No tools yet"). */
    emptyLabel: string
    /** Classify an item into its row/drawer descriptor. */
    describe: (item: unknown) => ItemDescriptor
    /** Structured editor for this kind. */
    FormView: ItemFormView
    /** Drawer header title for the current draft. */
    drawerTitle: (draft: Record<string, unknown>) => string
    /** Wider drawer. Per ITEM: one kind holds both a two-pane editor and a plain panel. */
    drawerWidth?: (item: Record<string, unknown>) => number | undefined
    /** Full-bleed body, for a Form that lays out its own master/detail. Per ITEM, as above. */
    formFlush?: (item: Record<string, unknown>) => boolean
    /** Default Form/JSON view when opening an existing item. */
    editView: (item: unknown) => ConfigItemView
    /** Items with no structured form open JSON-only (no Form/JSON toggle). */
    jsonOnly: (item: Record<string, unknown>) => boolean
    /** The item's form already states its identity, so the drawer drops its header chrome. */
    statesOwnIdentity?: (item: Record<string, unknown>) => boolean
    /** Hide the Form/JSON toggle for an item whose raw shape is an internal detail. */
    formOnly?: (item: Record<string, unknown>) => boolean
    /** Read-only items (e.g. static `__ag__*` skills) — viewable but not editable. */
    isReadOnly: (item: unknown) => boolean
    /** Seed for a fresh "create" draft. */
    createSeed: () => Record<string, unknown>
    /** Whether the draft is missing the minimum it needs to save. */
    draftInvalid: (draft: Record<string, unknown>) => boolean
}

export const ITEM_KINDS: Record<ItemKind, ItemKindDef> = {
    tool: {
        kind: "tool",
        field: "tools",
        icon: <Wrench size={16} />,
        noun: "tool",
        emptyLabel: "No tools yet",
        describe: describeTool,
        FormView: ToolFormView,
        // Only the two-pane parameter editor wants width and its own padding.
        drawerWidth: (draft) => (isReferenceTool(draft) ? undefined : 800),
        formFlush: (draft) => !isReferenceTool(draft),
        drawerTitle: (draft) => {
            // A subagent's header is the agent's NAME. describeTool would call it a workflow.
            if (isReferenceTool(draft)) return describeSubagent(draft).name
            const name = describeTool(draft).name
            return name && name !== "Tool" ? name : "New tool"
        },
        // Function, workflow-reference, and gateway ACTION tools (either encoding) have a
        // structured Form. Bare builtin/provider tools (a naked `type`) stay JSON-only, and so
        // does an integration entry: it is edited in the permission drawer, so a reader who does
        // reach it here (a diff row, a raw inspection) gets the JSON rather than an empty form.
        editView: (item) => {
            const entry = parseGatewayEntry(item)
            if (entry?.kind === "connection") return "json"
            return isFunctionTool(item) || isReferenceTool(item) || entry ? "form" : "json"
        },
        jsonOnly: (draft) => ITEM_KINDS.tool.editView(draft) === "json",
        // A subagent's detail states its own identity and hides the raw entry.
        statesOwnIdentity: (draft) => isReferenceTool(draft),
        formOnly: (draft) => isReferenceTool(draft),
        isReadOnly: () => false,
        // Unused for tools: creation seeds from the picker (buildInlineFunctionTool), not this.
        createSeed: () => ({}),
        draftInvalid: (draft) => {
            const fn = draft.function as Record<string, unknown> | undefined
            if (fn && typeof fn === "object") return !String(fn.name ?? "").trim()
            return false
        },
    },
    mcp: {
        kind: "mcp",
        field: "mcps",
        icon: <Plugs size={16} />,
        noun: "server",
        emptyLabel: "No MCPs yet",
        describe: describeMcp,
        FormView: McpServerFormView,
        drawerTitle: (draft) => String(draft.name ?? "").trim() || "New MCP server",
        editView: () => "form",
        jsonOnly: () => false,
        isReadOnly: () => false,
        createSeed: () => ({
            name: "",
            connection: {
                type: "http",
                url: "",
                credentials: {type: "none"},
            },
            policy: {tools: {mode: "all"}},
        }),
        draftInvalid: (draft) => {
            const name = String(draft.name ?? "").trim()
            const validName = /^[A-Za-z0-9._-]{1,128}$/.test(name)
            const connection =
                draft.connection && typeof draft.connection === "object"
                    ? (draft.connection as Record<string, unknown>)
                    : {}
            const url = String(connection.url ?? "").trim()
            const credentials =
                connection.credentials && typeof connection.credentials === "object"
                    ? (connection.credentials as Record<string, unknown>)
                    : {}
            const headers =
                credentials.headers && typeof credentials.headers === "object"
                    ? (credentials.headers as Record<string, unknown>)
                    : {}
            const missingSecretHeader =
                credentials.type === "header_secret_refs" &&
                !Object.entries(headers).some(
                    ([headerName, secretSlug]) =>
                        headerName.trim() && String(secretSlug ?? "").trim(),
                )
            return !validName || !url || missingSecretHeader
        },
    },
    skill: {
        kind: "skill",
        field: "skills",
        icon: <GraduationCap size={16} />,
        noun: "skill",
        emptyLabel: "No skills yet",
        describe: describeSkill,
        FormView: SkillFormView,
        // Wider than the default 600 — the skill drawer is two-pane (Files + editor).
        drawerWidth: () => 760,
        drawerTitle: (draft) =>
            isEmbedRefSkill(draft)
                ? "Skill reference"
                : String(draft.name ?? "").trim() || "New skill",
        editView: (item) => (isEmbedRefSkill(item) ? "json" : "form"),
        jsonOnly: (draft) => isEmbedRefSkill(draft),
        isReadOnly: (item) => isStaticSkill(item),
        createSeed: () => ({name: "", description: "", body: ""}),
        // `@ag.embed` references round-trip as-is; everything else must pass the SDK's own rules.
        draftInvalid: (draft) => !isEmbedRefSkill(draft) && skillDraftError(draft) !== undefined,
    },
}
