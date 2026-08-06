import type {ComponentType, ReactNode} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Copy, DownloadSimple} from "@phosphor-icons/react"
import {Dropdown, Tooltip, Typography} from "antd"
import type {MenuProps} from "antd"
import type {ColumnsType, ColumnType} from "antd/es/table"

import {InitialsAvatar} from "../../components/presentational/avatar"
import {CopyButton} from "../../components/presentational/CopyButton"
import {StatusIndicator, type StatusTone} from "../../components/presentational/status"
import {Tag, type TagProps} from "../../components/presentational/tag"
import {Button} from "../../components/ui/button"
import {copyToClipboard} from "../../utils/copyToClipboard"
import ColumnVisibilityMenuTrigger from "../components/columnVisibility/ColumnVisibilityMenuTrigger"
import SkeletonLine from "../components/common/SkeletonLine"
import type {InfiniteTableRowBase} from "../types"

// Default fallback for UserReference - just shows the userId
const DefaultUserReference = ({userId}: {userId: string | null | undefined}) => {
    if (!userId) return <Typography.Text type="secondary">—</Typography.Text>
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
    /** Custom value extractor for CSV export (read by useTableExport) */
    exportValue?: (row: T, column?: ColumnsType<T>[number], columnIndex?: number) => unknown
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

/**
 * Monospace value — API keys, masked secrets, hashes. Single line, truncates.
 * Use `slug` instead when the value is something the user pastes into code.
 */
export interface MonoColumnDef<T = unknown> {
    type: "mono"
    key: string
    title: string
    width?: number
    fixed?: "left" | "right"
    /** Custom value extractor (default: uses record[key]) */
    getValue?: (record: T) => string | null | undefined
    /** Rendered when the value is empty. @default "—" */
    emptyText?: string
}

/**
 * An identifier the user copies — slug, project ID, organization ID, email.
 * Always carries its own copy button: copying is a cell affordance, never a `⋯` menu item.
 */
export interface SlugColumnDef<T = unknown> {
    type: "slug"
    key: string
    title: string
    width?: number
    fixed?: "left" | "right"
    /** Custom value extractor (default: uses record[key]) */
    getValue?: (record: T) => string | null | undefined
    /** Rendered when the value is empty. @default "—" */
    emptyText?: string
}

/** A chip rendered beside an entity name (e.g. "You", "Default", "Pending"). */
export interface EntityChip {
    label: string
    tone?: TagProps["tone"]
    /**
     * `"tag"` (default) renders a filled pill; `"status"` renders a borderless dot + label
     * for the state a row is in (e.g. an invitation "Pending"/"Expired").
     */
    variant?: "tag" | "status"
}

const STATUS_CHIP_TONES = new Set<string>(["success", "warning", "error", "processing"])

const toStatusTone = (tone?: TagProps["tone"]): StatusTone =>
    typeof tone === "string" && STATUS_CHIP_TONES.has(tone) ? (tone as StatusTone) : "default"

/**
 * Avatar + name, with optional trailing chips. The chips stay on the same line as the
 * name — nothing stacks onto a second line inside a cell.
 */
export interface EntityColumnDef<T = unknown> {
    type: "entity"
    key: string
    title: string
    width?: number
    fixed?: "left" | "right"
    /** Display name (default: uses record[key]) */
    getName?: (record: T) => string
    /** Chips rendered after the name, e.g. "You" / "Default" / "Pending". */
    getChips?: (record: T) => EntityChip[]
    /** Hide the avatar and render the name alone. */
    hideAvatar?: boolean
}

export interface ActionItem<T> {
    key: string
    label: string
    icon?: ReactNode
    danger?: boolean
    onClick: (record: T, event?: {domEvent: React.MouseEvent | React.KeyboardEvent}) => void
    /** Hide this action conditionally */
    hidden?: (record: T) => boolean
    /** Render the action but block it — e.g. while the same action is already running. */
    disabled?: (record: T) => boolean
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
    /**
     * Render the column-visibility gear as the header cell. Set false on tables whose
     * columns are fixed per page (e.g. Settings), which frees the cell for a plain label.
     * @default true
     */
    showColumnVisibility?: boolean
}

export type StandardColumnDef<T = unknown> =
    | TextColumnDef<T>
    | DateColumnDef
    | UserColumnDef<T>
    | MonoColumnDef<T>
    | SlugColumnDef<T>
    | EntityColumnDef<T>
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
            case "mono":
                return createMonoColumn(def)
            case "slug":
                return createSlugColumn(def)
            case "entity":
                return createEntityColumn(def)
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
        render: ((value: unknown, record: T) => {
            if ((record as InfiniteTableRowBase).__isSkeleton) return <SkeletonLine width="55%" />
            if (def.render) return def.render(value, record)
            return value as ReactNode
        }) as ColumnType<T>["render"],
        // Lock column from being toggled in visibility menu (explicit or derived from fixed)
        columnVisibilityLocked: def.columnVisibilityLocked ?? Boolean(def.fixed),
        ...(def.exportValue ? {exportValue: def.exportValue} : {}),
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
        render: (date: string, record: T) => {
            if ((record as InfiniteTableRowBase).__isSkeleton) return <SkeletonLine width="40%" />
            const formatted = !date ? "—" : def.format ? def.format(date) : formatDateCell(date)
            return <div className="h-full flex items-center">{formatted}</div>
        },
        onHeaderCell: () => ({
            style: {minWidth: width},
        }),
    }
}

const readCell = <T,>(
    record: T,
    key: string,
    getValue?: (record: T) => string | null | undefined,
): string => {
    if (getValue) return getValue(record) ?? ""
    const raw = (record as Record<string, unknown>)[key]
    return typeof raw === "string" ? raw : ""
}

function createMonoColumn<T extends InfiniteTableRowBase>(def: MonoColumnDef<T>): ColumnType<T> {
    const {key, title, width, fixed, getValue, emptyText = "—"} = def

    return {
        title,
        dataIndex: key,
        key,
        width,
        minWidth: width,
        fixed,
        render: (_value: unknown, record: T) => {
            if (record.__isSkeleton) return <SkeletonLine width="70%" />
            const text = readCell(record, key, getValue)
            if (!text) return <Typography.Text type="secondary">{emptyText}</Typography.Text>
            return (
                <div className="h-full flex items-center min-w-0">
                    <span className="font-mono text-xs truncate" title={text}>
                        {text}
                    </span>
                </div>
            )
        },
        onHeaderCell: () => ({style: {minWidth: width}}),
    } as ColumnType<T>
}

function createSlugColumn<T extends InfiniteTableRowBase>(def: SlugColumnDef<T>): ColumnType<T> {
    const {key, title, width, fixed, getValue, emptyText = "—"} = def

    return {
        title,
        dataIndex: key,
        key,
        width,
        minWidth: width,
        fixed,
        render: (_value: unknown, record: T) => {
            if (record.__isSkeleton) return <SkeletonLine width="70%" />
            const text = readCell(record, key, getValue)
            if (!text) return <Typography.Text type="secondary">{emptyText}</Typography.Text>
            return (
                // `group` + the button's group-hover keeps the copy affordance quiet until
                // the row is hovered, matching the `⋯` button's behaviour.
                <div className="group h-full flex items-center gap-1 min-w-0">
                    <span className="font-mono text-xs truncate" title={text}>
                        {text}
                    </span>
                    <CopyButton
                        text={text}
                        buttonText={null}
                        icon
                        stopPropagation
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        successMessage={`${title} copied`}
                    />
                </div>
            )
        },
        onHeaderCell: () => ({style: {minWidth: width}}),
    } as ColumnType<T>
}

function createEntityColumn<T extends InfiniteTableRowBase>(
    def: EntityColumnDef<T>,
): ColumnType<T> {
    const {key, title, width, fixed, getName, getChips, hideAvatar} = def

    return {
        title,
        dataIndex: key,
        key,
        width,
        minWidth: width,
        fixed,
        render: (_value: unknown, record: T) => {
            if (record.__isSkeleton)
                return (
                    <div className="h-full flex items-center gap-2 min-w-0">
                        {hideAvatar ? null : (
                            <span className="h-6 w-6 shrink-0 rounded-full bg-colorFillSecondary animate-pulse" />
                        )}
                        <SkeletonLine width="50%" center={false} />
                    </div>
                )
            const name = getName ? getName(record) : readCell(record, key)
            const chips = getChips?.(record) ?? []
            return (
                <div className="h-full flex items-center gap-2 min-w-0">
                    {hideAvatar ? null : <InitialsAvatar size="small" name={name} />}
                    <span className="truncate" title={name}>
                        {name}
                    </span>
                    {chips.map((chip) =>
                        chip.variant === "status" ? (
                            <StatusIndicator
                                key={chip.label}
                                tone={toStatusTone(chip.tone)}
                                label={chip.label}
                                className="shrink-0"
                            />
                        ) : (
                            <Tag
                                key={chip.label}
                                size="small"
                                tone={chip.tone}
                                label={chip.label}
                                className="shrink-0 m-0"
                            />
                        ),
                    )}
                </div>
            )
        },
        onHeaderCell: () => ({style: {minWidth: width}}),
    } as ColumnType<T>
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
        showColumnVisibility = true,
    } = def

    const defaultGetId = (record: T): string => {
        if (getRecordId) return getRecordId(record)
        // InfiniteTableRowBase has index signature [key: string]: unknown
        const id = record.id ?? record._id ?? record.key
        if (typeof id === "string") return id
        return ""
    }

    return {
        title: showColumnVisibility ? <ColumnVisibilityMenuTrigger variant="icon" /> : null,
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

            // Build menu items from config
            // MenuInfo interface from antd/rc-menu
            interface MenuInfo {
                domEvent: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
            }
            const menuItems: NonNullable<MenuProps["items"]> = []

            items.forEach((item) => {
                if ("type" in item && item.type === "divider") {
                    const dividerItem = item as ActionDivider<T>
                    // Skip if hidden
                    if (dividerItem.hidden?.(record)) {
                        return
                    }
                    menuItems.push({type: "divider"})
                    return
                }

                const actionItem = item as ActionItem<T>

                // Skip if hidden
                if (actionItem.hidden?.(record)) {
                    return
                }

                const isDisabled = actionItem.disabled?.(record) ?? false

                menuItems.push({
                    key: actionItem.key,
                    label: actionItem.label,
                    icon: actionItem.icon,
                    danger: actionItem.danger,
                    disabled: isDisabled,
                    onClick: (e: MenuInfo) => {
                        e.domEvent.stopPropagation()
                        if (isDisabled) return
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
                    onClick: (e: MenuInfo) => {
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
                    const lastItem = menuItems[menuItems.length - 1]
                    if (
                        menuItems.length > 0 &&
                        lastItem &&
                        "type" in lastItem &&
                        lastItem.type !== "divider"
                    ) {
                        menuItems.push({type: "divider"})
                    }
                    menuItems.push({
                        key: "copy-id",
                        label: "Copy ID",
                        icon: <Copy size={16} />,
                        onClick: (e: MenuInfo) => {
                            e.domEvent.stopPropagation()
                            copyToClipboard(recordId)
                        },
                    })
                }
            }

            // Add copy slug if enabled
            if (showCopySlug && getSlug) {
                const slug = getSlug(record)
                if (slug) {
                    menuItems.push({
                        key: "copy-slug",
                        label: "Copy Slug",
                        icon: <Copy size={16} />,
                        onClick: (e: MenuInfo) => {
                            e.domEvent.stopPropagation()
                            copyToClipboard(slug)
                        },
                    })
                }
            }

            // Nothing to show for this row (every item hidden, no copy/export): render
            // no trigger rather than an empty ⋮ menu.
            if (menuItems.length === 0) return null

            return (
                <div
                    className="w-full h-full flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Dropdown
                        trigger={["click"]}
                        // minWidth (not a fixed width) so long labels like "Switch to this
                        // organization" grow the menu instead of wrapping onto two lines.
                        styles={{root: {minWidth: 200}}}
                        menu={{items: menuItems}}
                    >
                        <Tooltip title="Actions">
                            <Button onClick={(e) => e.stopPropagation()} variant="ghost" size="sm">
                                {<MoreOutlined />}
                            </Button>
                        </Tooltip>
                    </Dropdown>
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
            if (record.__isSkeleton) return <SkeletonLine width="55%" />
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
export {
    createTextColumn,
    createDateColumn,
    createUserColumn,
    createMonoColumn,
    createSlugColumn,
    createEntityColumn,
    createActionsColumn,
    formatDateCell,
}
