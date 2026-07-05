import React, {type ComponentType, type ReactNode} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {DotsThreeVertical, Copy, DownloadSimple} from "@phosphor-icons/react"
import type {ColumnsType, ColumnType} from "antd/es/table"

import {copyToClipboard} from "../../utils/copyToClipboard"
import ColumnVisibilityMenuTrigger from "../components/columnVisibility/ColumnVisibilityMenuTrigger"
import type {InfiniteTableRowBase} from "../types"

// Default fallback for UserReference - just shows the userId
const DefaultUserReference = ({userId}: {userId: string | null | undefined}) => {
    if (!userId) return <span className="text-muted-foreground">—</span>
    return <span className="truncate">{userId}</span>
}

// Configurable UserReference component
let UserReferenceComponent: ComponentType<{userId: string | null | undefined}> =
    DefaultUserReference

/**
 * Configure the UserReference component used by createUserColumn.
 * Call this at app initialization to provide your custom UserReference.
 *
 * @example
 * ```tsx
 * import { configureUserReference } from '@agenta/ui/table'
 * import { UserReference } from '@/oss/components/References'
 *
 * configureUserReference(UserReference)
 * ```
 */
export function configureUserReference(
    component: ComponentType<{userId: string | null | undefined}>,
) {
    UserReferenceComponent = component
}

// Use the configurable component
const UserReference = (props: {userId: string | null | undefined}) => (
    <UserReferenceComponent {...props} />
)

export interface TextColumnDef<T = unknown> {
    type: "text"
    key: string
    title: string
    width?: number
    render?: (value: unknown, record: T) => ReactNode
    /** Pin column to left or right */
    fixed?: "left" | "right"
    /** Lock column from being hidden in visibility menu (defaults to true if fixed is set) */
    columnVisibilityLocked?: boolean
}

export interface DateColumnDef {
    type: "date"
    key: string
    title: string
    width?: number
    /** Custom date formatter (default: formatDate from helpers) */
    format?: (date: string) => string
}

export interface UserColumnDef<T = unknown> {
    type: "user"
    /** The key in the record that contains the user ID */
    key: string
    title: string
    width?: number
    /** Custom user ID extractor (default: uses record[key]) */
    getUserId?: (record: T) => string | null | undefined
}

export interface ActionItem<T> {
    key: string
    label: string
    icon?: ReactNode
    danger?: boolean
    onClick: (record: T, event?: {domEvent: React.MouseEvent | React.KeyboardEvent}) => void
    /** Hide this action conditionally */
    hidden?: (record: T) => boolean
}

export interface ActionDivider<T> {
    type: "divider"
    hidden?: (record: T) => boolean
}

export interface ActionsColumnDef<T> {
    type: "actions"
    items: (ActionItem<T> | ActionDivider<T>)[]
    width?: number
    /** Maximum width for the actions column */
    maxWidth?: number
    /** Show copy ID action (default: true) */
    showCopyId?: boolean
    /** Custom ID extractor for copy action */
    getRecordId?: (record: T) => string
    /** Show copy slug action (default: false — requires getSlug to yield a value) */
    showCopySlug?: boolean
    /** Slug extractor for copy-slug action */
    getSlug?: (record: T) => string | null | undefined
    /** Export row callback */
    onExportRow?: (record: T) => void
    /** Whether export is currently in progress */
    isExporting?: boolean
}

export type StandardColumnDef<T = unknown> =
    | TextColumnDef<T>
    | DateColumnDef
    | UserColumnDef<T>
    | ActionsColumnDef<T>

/**
 * Create standard table columns from simplified definitions.
 * Reduces boilerplate for common column types.
 *
 * @example
 * ```tsx
 * const columns = createStandardColumns<TestsetTableRow>([
 *   { type: "text", key: "name", title: "Name", width: 300 },
 *   { type: "date", key: "updated_at", title: "Date Modified" },
 *   { type: "date", key: "created_at", title: "Date Created" },
 *   {
 *     type: "actions",
 *     items: [
 *       { key: "view", label: "View details", icon: <Note />, onClick: handleView },
 *       { key: "clone", label: "Clone", icon: <Copy />, onClick: handleClone },
 *       { type: "divider" },
 *       { key: "rename", label: "Rename", icon: <Pencil />, onClick: handleRename },
 *       { key: "delete", label: "Delete", icon: <Trash />, danger: true, onClick: handleDelete },
 *     ],
 *   },
 * ])
 * ```
 */
export function createStandardColumns<T extends InfiniteTableRowBase>(
    defs: StandardColumnDef<T>[],
): ColumnsType<T> {
    return defs.map((def) => {
        switch (def.type) {
            case "text":
                return createTextColumn(def)
            case "date":
                return createDateColumn(def)
            case "user":
                return createUserColumn(def)
            case "actions":
                return createActionsColumn(def)
            default: {
                // Exhaustive check - this should never be reached if all types are handled
                const exhaustiveCheck: never = def
                throw new Error(`Unknown column type: ${(exhaustiveCheck as {type: string}).type}`)
            }
        }
    })
}

function createTextColumn<T>(def: TextColumnDef<T>): ColumnType<T> {
    return {
        title: def.title,
        dataIndex: def.key,
        key: def.key,
        width: def.width,
        minWidth: def.width,
        fixed: def.fixed,
        render: def.render as ColumnType<T>["render"],
        // Lock column from being toggled in visibility menu (explicit or derived from fixed)
        columnVisibilityLocked: def.columnVisibilityLocked ?? Boolean(def.fixed),
        onHeaderCell: () => ({
            style: {minWidth: def.width},
        }),
    } as ColumnType<T>
}

const formatDateCell = (value?: string | null) => {
    if (!value) return "—"
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
        }).format(new Date(value))
    } catch {
        return value
    }
}

function createDateColumn<T>(def: DateColumnDef): ColumnType<T> {
    const width = def.width || 200
    return {
        title: def.title,
        dataIndex: def.key,
        key: def.key,
        width,
        minWidth: width,
        render: (date: string) => {
            const formatted = !date ? "—" : def.format ? def.format(date) : formatDateCell(date)
            return <div className="h-full flex items-center">{formatted}</div>
        },
        onHeaderCell: () => ({
            style: {minWidth: width},
        }),
    }
}

function createActionsColumn<T extends InfiniteTableRowBase>(
    def: ActionsColumnDef<T>,
): ColumnType<T> & {columnVisibilityLocked?: boolean; exportEnabled?: boolean} {
    const {
        items,
        width = 56, // TODO: try 61px here
        maxWidth,
        showCopyId = true,
        getRecordId,
        showCopySlug = false,
        getSlug,
        onExportRow,
        isExporting,
    } = def

    const defaultGetId = (record: T): string => {
        if (getRecordId) return getRecordId(record)
        // InfiniteTableRowBase has index signature [key: string]: unknown
        const id = record.id ?? record._id ?? record.key
        if (typeof id === "string") return id
        return ""
    }

    return {
        title: <ColumnVisibilityMenuTrigger variant="icon" />,
        key: "actions",
        width,
        ...(maxWidth ? {maxWidth} : {}),
        fixed: "right",
        align: "center",
        // Lock actions column from being toggled in visibility menu
        columnVisibilityLocked: true,
        // Exclude actions column from CSV export
        exportEnabled: false,
        onCell: () => ({className: "ag-table-actions-cell"}),
        render: (_, record) => {
            if (record.__isSkeleton) return null

            const menuItems: ReactNode[] = []

            items.forEach((item, idx) => {
                if ("type" in item && item.type === "divider") {
                    const dividerItem = item as ActionDivider<T>
                    if (dividerItem.hidden?.(record)) return
                    menuItems.push(<DropdownMenuSeparator key={`divider-${idx}`} />)
                    return
                }

                const actionItem = item as ActionItem<T>
                if (actionItem.hidden?.(record)) return

                menuItems.push(
                    <DropdownMenuItem
                        key={actionItem.key}
                        variant={actionItem.danger ? "destructive" : "default"}
                        onClick={(e) => {
                            e.stopPropagation()
                            actionItem.onClick(record)
                        }}
                    >
                        {actionItem.icon}
                        {actionItem.label}
                    </DropdownMenuItem>,
                )
            })

            if (onExportRow) {
                menuItems.push(
                    <DropdownMenuItem
                        key="export-row"
                        disabled={isExporting}
                        onClick={(e) => {
                            e.stopPropagation()
                            if (!isExporting) onExportRow(record)
                        }}
                    >
                        <DownloadSimple size={16} />
                        Export row
                    </DropdownMenuItem>,
                )
            }

            if (showCopyId) {
                const recordId = defaultGetId(record)
                if (recordId) {
                    const lastItem = menuItems[menuItems.length - 1]
                    if (
                        menuItems.length > 0 &&
                        lastItem &&
                        React.isValidElement(lastItem) &&
                        lastItem.type !== DropdownMenuSeparator
                    ) {
                        menuItems.push(<DropdownMenuSeparator key="copy-id-sep" />)
                    }
                    menuItems.push(
                        <DropdownMenuItem
                            key="copy-id"
                            onClick={(e) => {
                                e.stopPropagation()
                                copyToClipboard(recordId)
                            }}
                        >
                            <Copy size={16} />
                            Copy ID
                        </DropdownMenuItem>,
                    )
                }
            }

            if (showCopySlug && getSlug) {
                const slug = getSlug(record)
                if (slug) {
                    menuItems.push(
                        <DropdownMenuItem
                            key="copy-slug"
                            onClick={(e) => {
                                e.stopPropagation()
                                copyToClipboard(slug)
                            }}
                        >
                            <Copy size={16} />
                            Copy Slug
                        </DropdownMenuItem>,
                    )
                }
            }

            return (
                <div
                    className="w-full h-full flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                >
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            title="Actions"
                            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <DotsThreeVertical size={14} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" style={{width: 200}}>
                            {menuItems}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )
        },
    }
}

function createUserColumn<T extends InfiniteTableRowBase>(def: UserColumnDef<T>): ColumnType<T> {
    const {key, title, width = 180, getUserId} = def

    return {
        title,
        dataIndex: key,
        key,
        width,
        minWidth: width,
        render: (value: string | null | undefined, record: T) => {
            if (record.__isSkeleton) return null
            const userId = getUserId ? getUserId(record) : value
            return (
                <div className="h-full flex items-center">
                    <UserReference userId={userId} />
                </div>
            )
        },
        onHeaderCell: () => ({
            style: {minWidth: width},
        }),
    }
}

// Export individual column creators and utilities for custom use
export {createTextColumn, createDateColumn, createUserColumn, createActionsColumn, formatDateCell}
