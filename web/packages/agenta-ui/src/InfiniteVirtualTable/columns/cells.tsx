import {memo, type ReactNode} from "react"

import {cn} from "../../utils/styles"
import {useColumnVisibilityFlag} from "../context/ColumnVisibilityFlagContext"

import type {TableColumnCell} from "./types"

export const createComponentCell = <Row extends object>(opts: {
    render: (row: Row, index: number) => ReactNode
    align?: "left" | "right" | "center"
    className?: string
}): TableColumnCell<Row> => ({
    render: opts.render,
    align: opts.align,
    className: cn(opts.className),
})

interface ColumnVisibilityAwareCellProps<Row extends object> {
    row: Row
    index: number
    columnKey?: string
    render: (row: Row, index: number, isVisible: boolean) => ReactNode
    placeholder?: ReactNode | ((row: Row, index: number) => ReactNode)
    keepMounted?: boolean
}

const ColumnVisibilityAwareCellImpl = <Row extends object>({
    row,
    index,
    columnKey,
    render,
    placeholder,
    keepMounted = false,
}: ColumnVisibilityAwareCellProps<Row>) => {
    const isVisible = useColumnVisibilityFlag(columnKey)
    if (!keepMounted && !isVisible) {
        if (placeholder) {
            return (
                <div className="ivt-cell ivt-cell--column-visibility w-full h-full flex items-center">
                    {typeof placeholder === "function" ? placeholder(row, index) : placeholder}
                </div>
            )
        }
        return null
    }
    const content = render(row, index, isVisible)

    if (!content && !placeholder) {
        if (!keepMounted) {
            return null
        }
        return (
            <div className="ivt-cell ivt-cell--column-visibility w-full h-full flex items-center" />
        )
    }

    return (
        <div className="ivt-cell ivt-cell--column-visibility w-full h-full flex items-center">
            {content ?? (typeof placeholder === "function" ? placeholder(row, index) : placeholder)}
        </div>
    )
}

const ColumnVisibilityAwareCell = memo(
    ColumnVisibilityAwareCellImpl,
) as typeof ColumnVisibilityAwareCellImpl

export const createColumnVisibilityAwareCell = <Row extends object>(opts: {
    columnKey?: string
    render: (row: Row, index: number, isVisible: boolean) => ReactNode
    placeholder?: ReactNode | ((row: Row, index: number) => ReactNode)
    keepMounted?: boolean
    align?: "left" | "right" | "center"
    className?: string
}): TableColumnCell<Row> => ({
    render: (row, index) => (
        <ColumnVisibilityAwareCell<Row>
            row={row}
            index={index}
            columnKey={opts.columnKey}
            render={opts.render}
            placeholder={opts.placeholder}
            keepMounted={opts.keepMounted}
        />
    ),
    align: opts.align,
    className: cn("ivt-cell ivt-cell--column-visibility-wrapper", opts.className),
})
