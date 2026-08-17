import type {ComponentType, JSX, MouseEvent, ReactElement, ReactNode} from "react"

import type {PrimitiveAtom, WritableAtom} from "jotai"

export interface SidebarConfig {
    key: string
    title: string
    tooltip?: string
    link?: string
    icon?: ReactNode
    isHidden?: boolean
    submenu?: SidebarConfig[]
    defaultOpen?: boolean
    onClick?: (e: MouseEvent) => void
    tag?: string
    /** Right-aligned content (e.g. a version label); hidden when the rail is collapsed. */
    suffix?: ReactNode
    isCloudFeature?: boolean
    cloudFeatureTooltip?: string
    divider?: boolean
    disabled?: boolean
    dataTour?: string
    isDynamic?: boolean
    isLoading?: boolean
    isPlaceholder?: boolean
    /** A heading over the items below it, not a row: no icon, no hover, no click target. */
    isGroupLabel?: boolean
    /** Render the item normally but suppress its navigation — clicking it is a no-op (current location). */
    inert?: boolean
    /** Route prefixes that select this row; empty opts it out of matching. Defaults to `[link]`. */
    matchLinks?: string[]
    /** Wraps the row's label with per-row chrome (kebab / right-click menu). Skipped when collapsed. */
    wrapRow?: (node: ReactNode) => ReactElement
    /** Workflow categories that support this item. Omit to support every category. */
    workflowCategories?: readonly SidebarWorkflowCategory[]
}

export type SidebarWorkflowCategory = "app" | "agent" | "evaluator"

export type SidebarMenuMode = "horizontal" | "vertical" | "inline"

export interface SidebarMenuProps {
    items: SidebarConfig[]
    collapsed: boolean
    mode?: SidebarMenuMode
    openKeys?: string[]
    onToggleOpenKey?: (key: string) => void
    onPopupOpenChange?: (key: string, open: boolean) => void
}

export type SidebarSelection =
    | {mode: "route"; selectedKeyOverride?: string}
    | {mode: "controlled"; selectedKey: string; onSelect: (key: string) => void}

export interface SidebarSlotContext {
    collapsed: boolean
    lastPath?: string
}

export type SidebarSlot = ComponentType<SidebarSlotContext>

export interface SidebarSection {
    key: string
    items: SidebarConfig[]
    before?: SidebarSlot
    dividerBefore?: boolean
    placement?: "top" | "bottom"
    mode?: SidebarMenuMode
}

export interface SidebarScope {
    id: string
    lastPath?: string
    useSelection: () => SidebarSelection
    useSections: () => SidebarSection[]
    header?: SidebarSlot
    footer?: SidebarSlot
    /** Pinned slot rendered below the bottom section — the very last element in the rail. */
    afterBottom?: SidebarSlot
}

export interface SidebarShellProps {
    collapsedAtom: PrimitiveAtom<boolean>
    currentPath?: string
    onPopupOpenChange?: (key: string, open: boolean) => void
    openGroupsAtomFamily: (scopeId: string) => WritableAtom<string[] | undefined, [string[]], void>
    scope: SidebarScope
    theme?: "light" | "dark"
    /** Extra classes on the rail's outer frame — mounts differ (docked rail vs drawer sheet). */
    className?: string
    /** Called when a nav link is clicked; the drawer mount uses it to close itself. */
    onNavigate?: () => void
}
