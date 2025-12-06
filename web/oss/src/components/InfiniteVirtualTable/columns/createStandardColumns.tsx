import type {ReactNode} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Copy, DownloadSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"
import type {ColumnsType, ColumnType} from "antd/es/table"

import {UserReference} from "@/oss/components/References"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import ColumnVisibilityMenuTrigger from "../components/columnVisibility/ColumnVisibilityMenuTrigger"
import type {InfiniteTableRowBase} from "../types"

export interface TextColumnDef {
    type: "text"
    key: string
    title: string
    width?: number
    render?: (value: any, record: any) => ReactNode
    /** Pin column to left or right */
    fixed?: "left" | "right"
}

export interface DateColumnDef {
    type: "date"
    key: string
    title: string
    width?: number
    /** Custom date formatter (default: formatDate from helpers) */
    format?: (date: string) => string
}

export interface UserColumnDef<T = any> {
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
    onClick: (record: T, event?: any) => void
    /** Hide this action conditionally */
    hidden?: (record: T) => boolean
}

export interface ActionsColumnDef<T> {
    type: "actions"
    items: (ActionItem<T> | {type: "divider"})[]
    width?: number
    /** Show copy ID action (default: true) */
    showCopyId?: boolean
    /** Custom ID extractor for copy action */
    getRecordId?: (record: T) => string
    /** Export row callback */
    onExportRow?: (record: T) => void
    /** Whether export is currently in progress */
    isExporting?: boolean
}

export type StandardColumnDef<T = any> =
    | TextColumnDef
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
            default:
                throw new Error(`Unknown column type: ${(def as any).type}`)
        }
    })
}

function createTextColumn<T>(def: TextColumnDef): ColumnType<T> {
    return {
        title: def.title,
        dataIndex: def.key,
        key: def.key,
        width: def.width,
        fixed: def.fixed,
        render: def.render,
        onHeaderCell: () => ({
            style: {minWidth: def.width || 220},
        }),
    }
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
    return {
        title: def.title,
        dataIndex: def.key,
        key: def.key,
        width: def.width || 200,
        render: (date: string) => {
            if (!date) return "—"
            return def.format ? def.format(date) : formatDateCell(date)
        },
        onHeaderCell: () => ({
            style: {minWidth: def.width || 180},
        }),
    }
}

function createActionsColumn<T extends InfiniteTableRowBase>(
    def: ActionsColumnDef<T>,
): ColumnType<T> {
    const {items, width = 56, showCopyId = true, getRecordId, onExportRow, isExporting} = def

    const defaultGetId = (record: T): string => {
        if (getRecordId) return getRecordId(record)
        const id = (record as any).id || (record as any)._id || (record as any).key
        if (typeof id === "string") return id
        return ""
    }

    return {
        title: <ColumnVisibilityMenuTrigger variant="icon" />,
        key: "actions",
        width,
        fixed: "right",
        align: "center",
        render: (_, record) => {
            if (record.__isSkeleton) return null

            // Build menu items from config
            const menuItems: any[] = []

            items.forEach((item) => {
                if ("type" in item && item.type === "divider") {
                    menuItems.push({type: "divider"})
                    return
                }

                const actionItem = item as ActionItem<T>

                // Skip if hidden
                if (actionItem.hidden?.(record)) {
                    return
                }

                menuItems.push({
                    key: actionItem.key,
                    label: actionItem.label,
                    icon: actionItem.icon,
                    danger: actionItem.danger,
                    onClick: (e: any) => {
                        e.domEvent.stopPropagation()
                        actionItem.onClick(record, e)
                    },
                })
            })

            // Add export row if enabled
            if (onExportRow) {
                menuItems.push({
                    key: "export-row",
                    label: "Export row",
                    icon: <DownloadSimple size={16} />,
                    disabled: isExporting,
                    onClick: (e: any) => {
                        e.domEvent.stopPropagation()
                        if (!isExporting) {
                            onExportRow(record)
                        }
                    },
                })
            }

            // Add copy ID if enabled
            if (showCopyId) {
                const recordId = defaultGetId(record)
                if (recordId) {
                    if (
                        menuItems.length > 0 &&
                        menuItems[menuItems.length - 1].type !== "divider"
                    ) {
                        menuItems.push({type: "divider"})
                    }
                    menuItems.push({
                        key: "copy-id",
                        label: "Copy ID",
                        icon: <Copy size={16} />,
                        onClick: (e: any) => {
                            e.domEvent.stopPropagation()
                            copyToClipboard(recordId)
                        },
                    })
                }
            }

            return (
                <Dropdown trigger={["click"]} overlayStyle={{width: 200}} menu={{items: menuItems}}>
                    <Tooltip title="Actions">
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            icon={<MoreOutlined />}
                            size="small"
                        />
                    </Tooltip>
                </Dropdown>
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
        render: (value: string | null | undefined, record: T) => {
            if (record.__isSkeleton) return null
            const userId = getUserId ? getUserId(record) : value
            return <UserReference userId={userId} />
        },
        onHeaderCell: () => ({
            style: {minWidth: width},
        }),
    }
}

// Export individual column creators for custom use
export {createTextColumn, createDateColumn, createUserColumn, createActionsColumn}
