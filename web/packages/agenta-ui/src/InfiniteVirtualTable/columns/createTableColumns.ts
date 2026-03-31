import type {ReactNode} from "react"

import type {ColumnsType} from "antd/es/table"

import {cn} from "../../utils/styles"

import type {TableColumnConfig, TableColumnGroup, TableColumnCell} from "./types"

type ColumnWithChildren<Row extends object> = ColumnsType<Row>[number] & {
    children?: ColumnsType<Row>
}

/**
 * Extended column type with custom properties for visibility, export, etc.
 * This avoids `as any` type assertions throughout the codebase.
 */
interface ExtendedColumnProps<Row extends object> {
    "data-column-visibility-key"?: string
    columnVisibilityLabel?: string
    columnVisibilityLocked?: boolean
    columnVisibilityTitle?: ReactNode
    defaultHidden?: boolean
    exportLabel?: string
    exportEnabled?: boolean
    exportDataIndex?: unknown
    exportValue?: (row: Row, column?: ColumnsType<Row>[number], columnIndex?: number) => unknown
    exportFormatter?: (
        value: unknown,
        row: Row,
        column?: ColumnsType<Row>[number],
        columnIndex?: number,
    ) => string | undefined
    exportMetadata?: unknown
}

type ExtendedColumn<Row extends object> = ColumnWithChildren<Row> & ExtendedColumnProps<Row>

type OnHeaderCell<Row extends object> = ColumnsType<Row>[number]["onHeaderCell"]
type OnHeaderCellArgs<Row extends object> = Parameters<NonNullable<OnHeaderCell<Row>>>
type OnHeaderCellResult<Row extends object> = ReturnType<NonNullable<OnHeaderCell<Row>>>

const normalizeGroups = <Row extends object>(
    groups: TableColumnGroup<Row>[],
): TableColumnConfig<Row>[] =>
    groups.flatMap((group) => {
        if (Array.isArray(group)) {
            return group
        }
        return [group]
    })

const resolveTitle = <Row extends object>(
    config: TableColumnConfig<Row>,
    depth: number,
): ReactNode => {
    if (typeof config.title === "function") {
        return config.title({column: config, depth})
    }
    return config.title
}

const applyCellRenderer = <Row extends object>(
    column: ColumnsType<Row>[number],
    cell?: TableColumnCell<Row>,
) => {
    if (!cell) return
    column.render = (_value, record: Row, index) => cell.render(record, index)
    column.align = cell.align ?? column.align
    column.className = cn(column.className, cell.className)
}

const buildColumn = <Row extends object>(
    config: TableColumnConfig<Row>,
    depth = 0,
): ColumnsType<Row>[number] => {
    const column: ExtendedColumn<Row> = {
        key: config.key,
        title: resolveTitle(config, depth),
        width: config.width,
        fixed: config.fixed,
        align: config.align,
        ellipsis: config.ellipsis,
        className: cn(config.className),
        shouldCellUpdate: config.shouldCellUpdate,
    }

    applyCellRenderer(column, config.cell)

    if (config.children?.length) {
        column.children = config.children.map((child) => buildColumn(child, depth + 1))
    }

    if (config.minWidth || config.flex) {
        const prev = config.columnProps?.onHeaderCell
        column.onHeaderCell = (...args: OnHeaderCellArgs<Row>): OnHeaderCellResult<Row> => {
            const baseStyle: React.CSSProperties = {
                minWidth: config.minWidth,
                flex: config.flex,
            }
            const prevResult = typeof prev === "function" ? prev(...args) : undefined
            return {
                ...(prevResult ?? {}),
                style: {...baseStyle, ...(prevResult?.style ?? {})},
            }
        }
    }

    if (config.columnProps) {
        const {className, render, ...rest} = config.columnProps
        column.className = cn(column.className, className)
        Object.assign(column, rest)
        if (!column.render && render) {
            column.render = render
        }
    }

    if (config.visibilityKey) {
        column["data-column-visibility-key"] = config.visibilityKey
    }

    if (config.visibilityLabel) {
        column.columnVisibilityLabel = config.visibilityLabel
    }

    if (config.visibilityLocked) {
        column.columnVisibilityLocked = true
    }

    if (config.visibilityTitle) {
        column.columnVisibilityTitle = config.visibilityTitle
    }

    if (config.defaultHidden) {
        column.defaultHidden = true
    }

    if (config.exportLabel) {
        column.exportLabel = config.exportLabel
    }

    if (config.exportEnabled === false) {
        column.exportEnabled = false
    }

    if (config.exportDataIndex) {
        column.exportDataIndex = config.exportDataIndex
    }

    if (config.exportValue) {
        column.exportValue = config.exportValue
    }

    if (config.exportFormatter) {
        column.exportFormatter = config.exportFormatter
    }

    if (config.exportMetadata !== undefined) {
        column.exportMetadata = config.exportMetadata
    }

    return column
}

export const createTableColumns = <Row extends object>(
    groups: TableColumnGroup<Row>[],
): ColumnsType<Row> => normalizeGroups(groups).map((config) => buildColumn(config))
