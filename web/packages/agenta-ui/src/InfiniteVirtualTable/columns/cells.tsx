import {useEffect, memo, useRef, useState, type ReactNode} from "react"

import {cn} from "../../utils/styles"
import {useColumnVisibilityFlag} from "../context/ColumnVisibilityFlagContext"

import type {TableColumnCell} from "./types"

export const createTextCell = <Row extends object>(opts: {
    getValue: (row: Row) => ReactNode
    align?: "left" | "right" | "center"
    className?: string
}): TableColumnCell<Row> => ({
    render: opts.getValue,
    align: opts.align,
    className: cn("ivt-cell ivt-cell--text", opts.className),
})

export const createComponentCell = <Row extends object>(opts: {
    render: (row: Row, index: number) => ReactNode
    align?: "left" | "right" | "center"
    className?: string
}): TableColumnCell<Row> => ({
    render: opts.render,
    align: opts.align,
    className: cn(opts.className),
})

export const createStatusCell = <Row extends {status?: ReactNode}>(opts?: {
    formatter?: (status: ReactNode, row: Row) => ReactNode
    align?: "left" | "right" | "center"
    className?: string
}): TableColumnCell<Row> => ({
    render: (row) => {
        const value = row.status ?? null
        return opts?.formatter ? opts.formatter(value, row) : value
    },
    align: opts?.align ?? "left",
    className: cn("ivt-cell ivt-cell--status", opts?.className),
})

export const createActionsCell = <Row extends object>(opts: {
    render: (row: Row) => ReactNode
    className?: string
}): TableColumnCell<Row> => ({
    render: (row) => opts.render(row),
    className: cn("ivt-cell ivt-cell--actions", opts.className),
    align: "center",
})

const VisibilityObserverCell = <Row extends object>({
    row,
    index,
    render,
    onVisible,
    rootMargin,
    once,
    placeholder,
}: {
    row: Row
    index: number
    render: (row: Row, index: number, isVisible: boolean) => ReactNode
    onVisible?: (row: Row, index: number) => void
    rootMargin?: string
    once?: boolean
    placeholder?: ReactNode | ((row: Row, index: number) => ReactNode)
}) => {
    const ref = useRef<HTMLDivElement | null>(null)
    const hasTriggeredRef = useRef(false)
    const [isVisible, setIsVisible] = useState(!onVisible)

    useEffect(() => {
        if (!onVisible) return
        const element = ref.current
        if (!element) return
        let unsubscribed = false
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0]
                if (entry?.isIntersecting) {
                    setIsVisible(true)
                    if (once && hasTriggeredRef.current) return
                    onVisible(row, index)
                    if (once) {
                        hasTriggeredRef.current = true
                        observer.disconnect()
                        unsubscribed = true
                    }
                } else if (!once) {
                    setIsVisible(false)
                }
            },
            {rootMargin},
        )
        observer.observe(element)
        return () => {
            if (!unsubscribed) {
                observer.disconnect()
            }
        }
    }, [index, onVisible, once, rootMargin, row])

    const content =
        !isVisible && placeholder
            ? typeof placeholder === "function"
                ? placeholder(row, index)
                : placeholder
            : render(row, index, isVisible)

    return (
        <div ref={onVisible ? ref : null} className="ivt-cell ivt-cell--viewport">
            {content}
        </div>
    )
}

export const createViewportAwareCell = <Row extends object>(opts: {
    render: (row: Row, index: number, isVisible: boolean) => ReactNode
    onVisible?: (row: Row, index: number) => void
    rootMargin?: string
    align?: "left" | "right" | "center"
    className?: string
    once?: boolean
    placeholder?: ReactNode | ((row: Row, index: number) => ReactNode)
}): TableColumnCell<Row> => ({
    render: (row, index) => (
        <VisibilityObserverCell<Row>
            row={row}
            index={index}
            render={opts.render}
            onVisible={opts.onVisible}
            rootMargin={opts.rootMargin}
            once={opts.once}
            placeholder={opts.placeholder}
        />
    ),
    align: opts.align,
    className: cn("ivt-cell ivt-cell--viewport-wrapper", opts.className),
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
