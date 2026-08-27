import type {ReactNode} from "react"
import {useMemo} from "react"

import {cn} from "../../utils/styles"

/**
 * antd's `Pagination`, minus antd.
 *
 * Only what the table shell actually uses is here: a total, a page size, the current page and
 * an onChange, plus the optional total label. Deliberately not a general-purpose pager — the
 * point is to remove the last antd import from this package, not to reimplement antd.
 */

export interface PaginationProps {
    /** Total number of items, not pages. */
    total: number
    pageSize: number
    /** 1-based. */
    current: number
    onChange: (page: number, pageSize: number) => void
    /** Renders the label to the left of the pager. */
    showTotal?: (total: number, range: [number, number]) => ReactNode
    size?: "small" | "default"
    className?: string
}

/**
 * The classic elided pager: first, last, a window around the current page, and ellipses for
 * the gaps. Returns page numbers, with null standing in for a gap.
 */
export const getPageItems = (current: number, totalPages: number): (number | null)[] => {
    if (totalPages <= 7) return Array.from({length: totalPages}, (_, i) => i + 1)

    const items: (number | null)[] = [1]
    const start = Math.max(2, current - 1)
    const end = Math.min(totalPages - 1, current + 1)

    if (start > 2) items.push(null)
    for (let page = start; page <= end; page += 1) items.push(page)
    if (end < totalPages - 1) items.push(null)

    items.push(totalPages)
    return items
}

export function Pagination({
    total,
    pageSize,
    current,
    onChange,
    showTotal,
    size = "default",
    className,
}: PaginationProps) {
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
    const page = Math.min(Math.max(1, current), totalPages)
    const items = useMemo(() => getPageItems(page, totalPages), [page, totalPages])

    const range: [number, number] = [
        total === 0 ? 0 : (page - 1) * pageSize + 1,
        Math.min(page * pageSize, total),
    ]

    const box = size === "small" ? "h-6 min-w-6 text-xs" : "h-8 min-w-8 text-field-md"
    const step = (next: number) => () => {
        if (next >= 1 && next <= totalPages && next !== page) onChange(next, pageSize)
    }

    return (
        <nav
            aria-label="Pagination"
            className={cn("flex items-center gap-2 text-colorText", className)}
        >
            {showTotal ? (
                <span className="text-colorTextSecondary">{showTotal(total, range)}</span>
            ) : null}

            <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={step(page - 1)}
                className={cn(
                    box,
                    "box-border cursor-pointer rounded border border-solid border-colorBorder bg-colorBgContainer px-2",
                    "disabled:cursor-not-allowed disabled:text-colorTextDisabled",
                )}
            >
                ‹
            </button>

            {items.map((item, index) =>
                item === null ? (
                    // Gaps repeat, so the index is the only stable key available.
                    <span key={`gap-${index}`} className="px-1 text-colorTextSecondary">
                        …
                    </span>
                ) : (
                    <button
                        key={item}
                        type="button"
                        aria-label={`Page ${item}`}
                        aria-current={item === page ? "page" : undefined}
                        onClick={step(item)}
                        className={cn(
                            box,
                            "box-border cursor-pointer rounded border border-solid px-2",
                            item === page
                                ? "border-colorPrimary text-colorPrimary"
                                : "border-colorBorder bg-colorBgContainer",
                        )}
                    >
                        {item}
                    </button>
                ),
            )}

            <button
                type="button"
                aria-label="Next page"
                disabled={page >= totalPages}
                onClick={step(page + 1)}
                className={cn(
                    box,
                    "box-border cursor-pointer rounded border border-solid border-colorBorder bg-colorBgContainer px-2",
                    "disabled:cursor-not-allowed disabled:text-colorTextDisabled",
                )}
            >
                ›
            </button>
        </nav>
    )
}

export default Pagination
