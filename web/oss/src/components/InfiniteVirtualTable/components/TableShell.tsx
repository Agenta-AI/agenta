import type {ReactNode} from "react"
import {useLayoutEffect, useRef} from "react"

import clsx from "clsx"

interface TableShellProps {
    title?: ReactNode
    description?: ReactNode
    badge?: ReactNode
    header?: ReactNode
    /** Additional content to render in the header row (e.g., tabs) */
    headerExtra?: ReactNode
    filters?: ReactNode
    primaryActions?: ReactNode
    secondaryActions?: ReactNode
    className?: string
    contentClassName?: string
    onHeaderHeightChange?: (height: number) => void
    children: ReactNode
}

const TableShell = ({
    title,
    description,
    badge,
    header,
    headerExtra,
    filters,
    primaryActions,
    secondaryActions,
    className,
    contentClassName,
    onHeaderHeightChange,
    children,
}: TableShellProps) => {
    const headerRef = useRef<HTMLDivElement | null>(null)

    useLayoutEffect(() => {
        if (!onHeaderHeightChange) return
        const element = headerRef.current
        if (!element) {
            onHeaderHeightChange(0)
            return
        }
        const update = () => {
            onHeaderHeightChange(element.getBoundingClientRect().height)
        }
        update()
        const observer = new ResizeObserver(() => update())
        observer.observe(element)
        return () => observer.disconnect()
    }, [onHeaderHeightChange])

    const renderDefaultHeader = () => (
        <div className="flex flex-col items-start gap-4 w-full">
            {title || headerExtra ? (
                <div className="w-full flex items-start justify-between gap-4 mb-4">
                    {title ? (
                        <div className="flex items-center gap-3 shrink min-w-0">
                            <div className="font-medium text-[#101828]">{title}</div>
                            {badge}
                        </div>
                    ) : null}
                    {headerExtra ? (
                        <div className="flex items-center justify-end shrink-0">{headerExtra}</div>
                    ) : null}
                </div>
            ) : null}
            {description ? <div className="text-[#475467]">{description}</div> : null}
            <div className="w-full flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-[200px] flex-1 flex-col gap-2">{filters}</div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {secondaryActions}
                    {primaryActions}
                </div>
            </div>
        </div>
    )

    const headerNode = header ?? renderDefaultHeader()

    return (
        <div className={clsx("flex min-h-0 flex-col gap-4", className)}>
            {headerNode ? (
                <div ref={headerRef} className="flex-shrink-0">
                    {headerNode}
                </div>
            ) : null}
            <div className={clsx("flex-1 min-h-0 flex flex-col", contentClassName)}>{children}</div>
        </div>
    )
}

export default TableShell
