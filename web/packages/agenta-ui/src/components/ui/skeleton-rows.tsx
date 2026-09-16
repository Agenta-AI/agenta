import * as React from "react"

import {SkeletonBlock} from "./skeleton"
import {cn} from "./utils"

/**
 * SkeletonRows — the loading state for a list of rows: N bars at the row's own height.
 *
 * Shared so that two surfaces loading the same kind of list do not shimmer differently. The
 * placeholder is decorative, so the whole block is hidden from assistive technology and the
 * surface announces its loading state itself.
 */
export interface SkeletonRowsProps extends React.HTMLAttributes<HTMLDivElement> {
    /** How many rows to draw. Three is what the list surfaces use. */
    count?: number
    /** antd's shimmer. */
    active?: boolean
    /** Height and radius of one row; the default is the list row's 48px. */
    rowClassName?: string
}

export function SkeletonRows({
    count = 3,
    active = true,
    className,
    rowClassName,
    ...props
}: SkeletonRowsProps) {
    return (
        <div
            data-slot="skeleton-rows"
            aria-hidden
            className={cn("flex flex-col gap-2", className)}
            {...props}
        >
            {Array.from({length: count}).map((_, i) => (
                <SkeletonBlock
                    key={i}
                    active={active}
                    shape="round"
                    className={cn("h-12 w-full", rowClassName)}
                />
            ))}
        </div>
    )
}
