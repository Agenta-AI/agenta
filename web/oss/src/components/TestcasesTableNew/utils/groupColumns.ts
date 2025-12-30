import type {ReactNode} from "react"

import type {ColumnType} from "antd/es/table"

import type {Column} from "@/oss/state/entities/testcase/columnState"

/**
 * Represents a column group with nested children
 */
export interface ColumnGroup<T> {
    key: string
    title: string
    children: ColumnType<T>[]
}

/**
 * Result of grouping columns - either a regular column or a group
 */
export type GroupedColumn<T> = ColumnType<T> | ColumnGroup<T>

/** Default max depth for group expansion (1 = only top-level groups expand by default) */
const DEFAULT_MAX_DEPTH = 1

/**
 * Options for groupColumns function
 */
export interface GroupColumnsOptions<T> {
    /** Set of collapsed group names */
    collapsedGroups?: Set<string>
    /** Callback when a group header is clicked (for toggling collapse) */
    onGroupHeaderClick?: (groupName: string) => void
    /** Function to render the group header (receives groupName, isCollapsed, childCount) */
    renderGroupHeader?: (groupName: string, isCollapsed: boolean, childCount: number) => ReactNode
    /** Function to create a collapsed column (shows full JSON) */
    createCollapsedColumnDef?: (groupName: string, childColumns: Column[]) => ColumnType<T>
    /** Maximum depth for group expansion (default: 2). Beyond this depth, columns show as JSON */
    maxDepth?: number
}

/**
 * Check if a column name indicates it belongs to a group
 * Group columns have format: "groupname.columnname"
 */
export function isGroupedColumnKey(key: string): boolean {
    return key.includes(".")
}

/**
 * Parse a grouped column key into group name and column name
 * Only splits on the FIRST dot to get the top-level group
 * e.g., "inputs.country" -> { groupName: "inputs", columnName: "country" }
 * e.g., "current_rfp.event.type" -> { groupName: "current_rfp", columnName: "event.type" }
 */
export function parseGroupedColumnKey(key: string): {groupName: string; columnName: string} | null {
    const dotIndex = key.indexOf(".")
    if (dotIndex === -1) return null

    return {
        groupName: key.substring(0, dotIndex),
        columnName: key.substring(dotIndex + 1),
    }
}

/**
 * Get the leaf name from a potentially nested column key
 * e.g., "event.type" -> "type"
 * e.g., "current_rfp.event.location.city" -> "city"
 */
export function getLeafColumnName(key: string): string {
    const lastDotIndex = key.lastIndexOf(".")
    if (lastDotIndex === -1) return key
    return key.substring(lastDotIndex + 1)
}

/**
 * Recursively group columns into nested structure
 * This handles deeply nested paths like "a.b.c.d" by creating nested group headers
 * Respects maxDepth to limit nesting for performance
 */
function groupColumnsRecursive<T>(
    columns: Column[],
    createColumnDef: (col: Column, displayName: string) => ColumnType<T>,
    options: GroupColumnsOptions<T> | undefined,
    parentPath: string,
    currentDepth: number,
): ColumnType<T>[] {
    const {
        collapsedGroups,
        onGroupHeaderClick,
        renderGroupHeader,
        createCollapsedColumnDef,
        maxDepth = DEFAULT_MAX_DEPTH,
    } = options ?? {}

    const result: ColumnType<T>[] = []
    const groupMap = new Map<string, {columns: Column[]; order: number}>()
    let orderCounter = 0

    // First pass: categorize columns into groups or standalone (leaf columns)
    columns.forEach((col) => {
        // Get the relative key (remove parent path prefix if present)
        const relativeKey = parentPath ? col.key.substring(parentPath.length + 1) : col.key
        const parsed = parseGroupedColumnKey(relativeKey)

        if (parsed) {
            // This column has more nesting - group by first segment
            const existing = groupMap.get(parsed.groupName)
            if (existing) {
                existing.columns.push(col)
            } else {
                groupMap.set(parsed.groupName, {
                    columns: [col],
                    order: orderCounter++,
                })
            }
        } else {
            // Leaf column - no more dots in relative key
            // Use relativeKey as display name (it's already the name relative to parent group)
            const displayName = relativeKey
            result.push({
                ...createColumnDef(col, displayName),
                __order: orderCounter++,
            } as ColumnType<T> & {__order: number})
        }
    })

    // Second pass: create group columns (recursively or collapsed based on depth)
    groupMap.forEach((group, groupName) => {
        const fullGroupPath = parentPath ? `${parentPath}.${groupName}` : groupName
        const isInCollapsedSet = collapsedGroups?.has(fullGroupPath) ?? false
        const isAtDepthLimit = currentDepth >= maxDepth

        // Collapse logic with inverted behavior for depth-limited groups:
        // - Normal groups (depth < maxDepth): collapsed if IN the set, expanded by default
        // - Depth-limited groups (depth >= maxDepth): collapsed by default, expanded if IN the set
        // This allows users to click to expand depth-limited groups (adds to set),
        // and click again to collapse (removes from set)
        const isCollapsed = isAtDepthLimit ? !isInCollapsedSet : isInCollapsedSet

        if (isCollapsed && createCollapsedColumnDef) {
            // Collapsed state: show single column with full JSON
            const collapsedCol = createCollapsedColumnDef(fullGroupPath, group.columns)
            result.push({
                ...collapsedCol,
                __order: group.order,
            } as ColumnType<T> & {__order: number})
        } else {
            // Expanded state: recursively group children
            const children = groupColumnsRecursive(
                group.columns,
                createColumnDef,
                options,
                fullGroupPath,
                currentDepth + 1,
            )

            // Create group header title - click handler is embedded in the rendered element
            const title =
                renderGroupHeader && onGroupHeaderClick
                    ? renderGroupHeader(fullGroupPath, isCollapsed, countLeafColumns(children))
                    : groupName

            result.push({
                key: `__group_${fullGroupPath}`,
                title,
                children,
                __order: group.order,
            } as ColumnType<T> & {__order: number})
        }
    })

    // Sort by original order to maintain column sequence
    result.sort((a, b) => {
        const orderA = (a as ColumnType<T> & {__order?: number}).__order ?? 0
        const orderB = (b as ColumnType<T> & {__order?: number}).__order ?? 0
        return orderA - orderB
    })

    // Clean up __order property
    result.forEach((col) => {
        delete (col as ColumnType<T> & {__order?: number}).__order
    })

    return result
}

/**
 * Count leaf columns in a nested column structure
 */
function countLeafColumns<T>(columns: ColumnType<T>[]): number {
    let count = 0
    columns.forEach((col) => {
        const children = (col as ColumnType<T> & {children?: ColumnType<T>[]}).children
        if (children && children.length > 0) {
            count += countLeafColumns(children)
        } else {
            count += 1
        }
    })
    return count
}

/**
 * Transform flat columns into grouped columns for Ant Design table
 *
 * Columns with keys like "group.subcolumn" will be grouped under a parent header "group"
 * with child columns showing just "subcolumn"
 *
 * Supports nested grouping - "a.b.c" creates nested headers: a > b > c
 * Supports collapsing groups - when collapsed, shows a single column with full JSON
 *
 * @param columns - Flat array of columns
 * @param createColumnDef - Function to create the column definition for each column
 * @param options - Optional configuration for collapse behavior
 * @returns Array of columns with groups where applicable
 */
export function groupColumns<T>(
    columns: Column[],
    createColumnDef: (col: Column, displayName: string) => ColumnType<T>,
    options?: GroupColumnsOptions<T>,
): ColumnType<T>[] {
    return groupColumnsRecursive(columns, createColumnDef, options, "", 0)
}
