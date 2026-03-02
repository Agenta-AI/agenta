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
    const lastHeightRef = useRef<number>(0)

    useLayoutEffect(() => {
        if (!onHeaderHeightChange) return
        const element = headerRef.current
        if (!element) {
            if (lastHeightRef.current !== 0) {
                lastHeightRef.current = 0
                onHeaderHeightChange(0)
            }
            return
        }
        const update = () => {
            const nextHeight = element.getBoundingClientRect().height
            // Only call callback if height actually changed
            // This prevents infinite loops during horizontal scroll
            if (lastHeightRef.current !== nextHeight) {
                lastHeightRef.current = nextHeight
                onHeaderHeightChange(nextHeight)
            }
        }
        update()
        const observer = new ResizeObserver(() => update())
        observer.observe(element)
        return () => observer.disconnect()
    }, [onHeaderHeightChange])

    const renderDefaultHeader = () => (
        <div className="flex flex-col items-start gap-4 w-full">
            {title || headerExtra || (!filters && (primaryActions || secondaryActions)) ? (
                <div className="w-full flex flex-wrap items-center justify-between gap-4">
                    {title ? (
                        <div className="flex items-center gap-3 shrink min-w-0">
                            <div className="font-medium text-[#101828]">{title}</div>
                            {badge}
                        </div>
                    ) : (
                        <div className="min-w-0" />
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-3 ml-auto">
                        {headerExtra}
                        {!filters ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {secondaryActions}
                                {primaryActions}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {description ? <div className="text-[#475467]">{description}</div> : null}

            {filters ? (
                <div className="w-full flex flex-wrap items-center justify-between gap-4">
                    <div className="flex min-w-[200px] flex-1 flex-col gap-2">{filters}</div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {secondaryActions}
                        {primaryActions}
                    </div>
                </div>
            ) : null}
        </div>
    )

    const headerNode = header ?? renderDefaultHeader()

    return (
        <div className={clsx("flex min-h-0 flex-col gap-2", className)}>
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
