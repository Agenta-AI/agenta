import type {ComponentType, MouseEvent, ReactElement, ReactNode} from "react"

import type {PrimitiveAtom, WritableAtom} from "jotai"

/**
 * Identity of a hand-arrangeable row or heading. Items sharing a `zone` reorder against each
 * other and nothing else — which is what makes a cross-heading drop impossible by construction.
 */
export interface SidebarDragItem {
    kind: "row" | "group"
    /** The persisted id: an agent id, a session id, or a heading key. */
    id: string
    zone: string
}

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
    /** A heading over the items below it, not a row: no icon, no hover, no click target.
     * A heading that also carries `onClick` is collapsible and draws a caret. */
    isGroupLabel?: boolean
    /** Collapsible heading only: whether its rows are folded away. Drives the caret. */
    isCollapsed?: boolean
    /** Render the item normally but suppress its navigation — clicking it is a no-op (current location). */
    inert?: boolean
    /** Route prefixes that select this row; empty opts it out of matching. Defaults to `[link]`. */
    matchLinks?: string[]
    /** Wraps the row's label with per-row chrome (kebab / right-click menu). Skipped when collapsed. */
    wrapRow?: (node: ReactNode) => ReactElement
    /** Extra classes on the row itself — for state the label cannot carry, e.g. an archived
     * session rendering faded. Opt-in: a row that sets none renders exactly as before. */
    rowClassName?: string
    /** Set on rows and headings the user may hand-arrange. Absent = fixed in place. */
    dragItem?: SidebarDragItem
    /** A group with no collapse control: it renders no caret and stays expanded. Its own row
     * chrome (a filter, say) is the affordance instead. Also keeps its key in the shell's open
     * set, so a gated dynamic source stays subscribed. */
    alwaysOpen?: boolean
    /** Rendered beside a group's expand caret — a filter control, say. Interactive, so it sits
     * outside the row's stretched link anchor. Groups only; hidden when the rail is collapsed. */
    groupAction?: ReactNode
    /** Collapsed rail: render this group as a plain icon link instead of a children flyout. */
    hideChildrenWhenCollapsed?: boolean
    /** This group's ROWS scroll, not the whole rail: the group shrinks to the space left over
     * and scrolls inside itself, so the entries after it stay on screen however long it grows.
     * Opt-in — a rail with no such group keeps scrolling as a whole. */
    scrollChildren?: boolean
    /** Scrolled near the end of a `scrollChildren` group — load the next page. */
    onReachEnd?: () => void
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
    /** Set only where the rail is a dismissible overlay (the small-screen drawer). A docked rail
     * passes none, which is how a slot tells the two mounts apart without guessing a breakpoint. */
    onDismiss?: () => void
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
    /** Dismisses the rail. Passed ONLY by an overlay mount (the drawer), so the header slot can
     * offer a close instead of a collapse toggle without testing a viewport width. */
    onDismiss?: () => void
}
