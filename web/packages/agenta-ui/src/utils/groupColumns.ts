/**
 * Column Grouping Utilities
 *
 * Provides utilities for grouping nested columns into hierarchical structures
 * for table display. Works with any column type that has `key` and optional
 * `parentKey` and `label` properties.
 */

import type {ReactNode} from "react"

import type {ColumnType} from "antd/es/table"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Minimal column interface required for grouping.
 * Any column type with these properties can be grouped.
 */
export interface GroupableColumn {
    /** Column key (field name or full path for expanded columns) */
    key: string
    /** Display label (defaults to key) */
    label?: string
    /** Alternative display name (used if label is not provided) */
    name?: string
    /** Parent column key (for grouped/expanded columns) */
    parentKey?: string
}

/**
 * Options for groupColumns function
 * @template T - The row data type for the table
 * @template C - The column type (must extend GroupableColumn)
 */
export interface GroupColumnsOptions<T, C extends GroupableColumn = GroupableColumn> {
    /** Set of collapsed group paths */
    collapsedGroups?: Set<string>
    /** Callback when a group header is clicked (for toggling collapse) */
    onGroupHeaderClick?: (groupPath: string) => void
    /** Function to render the group header */
    renderGroupHeader?: (groupPath: string, isCollapsed: boolean, childCount: number) => ReactNode
    /** Function to create a collapsed column (shows full JSON) */
    createCollapsedColumnDef?: (groupPath: string, childColumns: C[]) => ColumnType<T>
    /** Maximum depth for group expansion (default: 1). Beyond this depth, columns show as JSON */
    maxDepth?: number
}

// ============================================================================
// UTILITIES
// ============================================================================

/** Default max depth for group expansion */
const DEFAULT_MAX_DEPTH = 1

/** Internal column type with ordering metadata for sorting during grouping */
type OrderedColumn<T> = ColumnType<T> & {__order?: number}

/**
 * Check if a column key indicates it belongs to a group
 * Group columns have format: "groupname.columnname"
 */
export function isGroupedColumnKey(key: string): boolean {
    return key.includes(".")
}

/**
 * Parse a grouped column key into group name and column name
 * Only splits on the FIRST dot to get the top-level group
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
 */
export function getLeafColumnName(key: string): string {
    const lastDotIndex = key.lastIndexOf(".")
    if (lastDotIndex === -1) return key
    return key.substring(lastDotIndex + 1)
}

/**
 * Check if a column is an expanded column (came from object expansion)
 * Expanded columns have parentKey property set
 */
function isExpandedColumn(col: GroupableColumn): boolean {
    return "parentKey" in col && typeof col.parentKey === "string" && col.parentKey.length > 0
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
 * Recursively group columns into nested structure
 *
 * IMPORTANT: Only groups columns that came from object expansion (have parentKey).
 * Columns with dots in their flat key names (e.g., "agents.md") are NOT grouped.
 */
function groupColumnsRecursive<T, C extends GroupableColumn>(
    columns: C[],
    createColumnDef: (col: C, displayName: string) => ColumnType<T>,
    options: GroupColumnsOptions<T, C> | undefined,
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
    const groupMap = new Map<string, {columns: C[]; order: number}>()
    let orderCounter = 0

    // First pass: categorize columns into groups or standalone (leaf columns)
    columns.forEach((col) => {
        const expanded = isExpandedColumn(col)

        // Only group columns that came from object expansion (have parentKey)
        // Flat columns with dots in their names (e.g., "agents.md") should NOT be grouped
        if (!expanded && currentDepth === 0) {
            // Top-level flat column - render as-is, even if it has dots
            result.push({
                ...createColumnDef(col, col.label || col.name || col.key),
                __order: orderCounter++,
            } as OrderedColumn<T>)
            return
        }

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
            const displayName = relativeKey
            result.push({
                ...createColumnDef(col, displayName),
                __order: orderCounter++,
            } as OrderedColumn<T>)
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
        const isCollapsed = isAtDepthLimit ? !isInCollapsedSet : isInCollapsedSet

        if (isCollapsed && createCollapsedColumnDef) {
            // Collapsed state: show single column with full JSON
            const collapsedCol = createCollapsedColumnDef(fullGroupPath, group.columns)
            result.push({
                ...collapsedCol,
                __order: group.order,
            } as OrderedColumn<T>)
        } else {
            // Expanded state: recursively group children
            const children = groupColumnsRecursive(
                group.columns,
                createColumnDef,
                options,
                fullGroupPath,
                currentDepth + 1,
            )

            // Create group header title
            const title =
                renderGroupHeader && onGroupHeaderClick
                    ? renderGroupHeader(fullGroupPath, isCollapsed, countLeafColumns(children))
                    : groupName

            result.push({
                key: `__group_${fullGroupPath}`,
                title,
                children,
                __order: group.order,
            } as OrderedColumn<T>)
        }
    })

    // Sort by original order to maintain column sequence
    result.sort((a, b) => {
        const orderA = (a as OrderedColumn<T>).__order ?? 0
        const orderB = (b as OrderedColumn<T>).__order ?? 0
        return orderA - orderB
    })

    // Clean up __order property
    result.forEach((col) => {
        delete (col as OrderedColumn<T>).__order
    })

    return result
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
 * @param columns - Flat array of columns (must have parentKey for grouping)
 * @param createColumnDef - Function to create the column definition for each column
 * @param options - Optional configuration for collapse behavior
 * @returns Array of columns with groups where applicable
 */
export function groupColumns<T, C extends GroupableColumn = GroupableColumn>(
    columns: C[],
    createColumnDef: (col: C, displayName: string) => ColumnType<T>,
    options?: GroupColumnsOptions<T, C>,
): ColumnType<T>[] {
    return groupColumnsRecursive(columns, createColumnDef, options, "", 0)
}
