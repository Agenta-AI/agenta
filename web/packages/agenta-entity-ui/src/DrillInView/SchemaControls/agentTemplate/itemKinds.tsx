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
import {ToolFormView} from "../ToolFormView"
import {parseGatewayTool} from "../toolUtils"

import {
    describeMcp,
    describeSkill,
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
    /** Wider drawer for kinds that need it (skills are two-pane). */
    drawerWidth?: number
    /** Full-bleed body so the Form can lay out its own master/detail (the tool parameter editor). */
    formFlush?: boolean
    /** Default Form/JSON view when opening an existing item. */
    editView: (item: unknown) => ConfigItemView
    /** Items with no structured form open JSON-only (no Form/JSON toggle). */
    jsonOnly: (item: Record<string, unknown>) => boolean
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
        // Two-panel parameter master/detail — needs width + a full-bleed body.
        drawerWidth: 800,
        formFlush: true,
        drawerTitle: (draft) => {
            const name = describeTool(draft).name
            return name && name !== "Tool" ? name : "New tool"
        },
        // Function, workflow-reference, and gateway tools (either encoding) have a structured Form;
        // only bare builtin/provider tools (a naked `type`) stay JSON-only. A canonical gateway
        // object opens the Form via `parseGatewayTool`; a legacy one is already a function tool.
        editView: (item) =>
            isFunctionTool(item) || isReferenceTool(item) || parseGatewayTool(item)
                ? "form"
                : "json",
        jsonOnly: (draft) =>
            !isFunctionTool(draft) && !isReferenceTool(draft) && !parseGatewayTool(draft),
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
        emptyLabel: "No MCP servers yet",
        describe: describeMcp,
        FormView: McpServerFormView,
        drawerTitle: (draft) => String(draft.name ?? "").trim() || "New MCP server",
        editView: () => "form",
        jsonOnly: () => false,
        isReadOnly: () => false,
        createSeed: () => ({name: "", transport: "stdio", command: "", args: []}),
        draftInvalid: (draft) => {
            // A server needs a launch target too, not just a name: stdio → command, http → url.
            const name = String(draft.name ?? "").trim()
            const transport = draft.transport === "http" ? "http" : "stdio"
            const target =
                transport === "http"
                    ? String(draft.url ?? "").trim()
                    : String(draft.command ?? "").trim()
            return !name || !target
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
        drawerWidth: 760,
        drawerTitle: (draft) =>
            isEmbedRefSkill(draft)
                ? "Skill reference"
                : String(draft.name ?? "").trim() || "New skill",
        editView: (item) => (isEmbedRefSkill(item) ? "json" : "form"),
        jsonOnly: (draft) => isEmbedRefSkill(draft),
        isReadOnly: (item) => isStaticSkill(item),
        createSeed: () => ({name: "", description: "", body: ""}),
        // `@ag.embed` skill references carry no name and are always valid (they round-trip as-is).
        draftInvalid: (draft) => !isEmbedRefSkill(draft) && !String(draft.name ?? "").trim(),
    },
}
