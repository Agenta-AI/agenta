import type {ComponentType, ReactNode} from "react"

import type {ItemDescriptor} from "../itemDescriptors"

export type ItemKind = "tool" | "mcp" | "skill"

/** The structured form view for a kind — Tool/Mcp/Skill all share this prop shape. */
export type ItemFormView = ComponentType<{
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    disabled?: boolean
    /** Paint the empty required fields. Only the skill form reads it; the others ignore it. */
    showMissing?: boolean
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
    /** Items with no structured form show their raw JSON instead. */
    jsonOnly: (item: Record<string, unknown>) => boolean
    /** The item's form already states its identity, so the drawer drops its header chrome. */
    statesOwnIdentity?: (item: Record<string, unknown>) => boolean
    /** Read-only items (e.g. static `__ag__*` skills) — viewable but not editable. */
    isReadOnly: (item: unknown) => boolean
    /** Seed for a fresh "create" draft. */
    createSeed: () => Record<string, unknown>
    /** Whether the draft is missing the minimum it needs to save. */
    draftInvalid: (draft: Record<string, unknown>) => boolean
}
