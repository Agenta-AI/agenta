/**
 * FilterRailLayout — THE browse-page frame: a filter rail beside a scrolling result column.
 *
 * The pattern it fixes: anything you filter WITH (the page title, its search box, its facet list)
 * belongs in the rail, never in the scrolling column — a search box that scrolls away is unusable
 * the moment the results are longer than the viewport. The rail is a full-height flex sibling and
 * scrolls only itself, so it stays put however far the results run.
 *
 * Used by every browse surface: the templates gallery, the sessions page, mobile's session list.
 *
 * Below `lg` the rail stacks above the results (there is no room beside them) and loses its tinted
 * sidebar surface; the host is free to lay its rail contents out horizontally at that size.
 *
 * The content column is deliberately NOT given `overflow`: which element scrolls differs per page
 * (some hand it to a virtualized list, mobile's screens scroll their whole scaffold below `lg`), so
 * that stays the host's call via `contentClassName`.
 *
 * @example
 * ```tsx
 * <FilterRailLayout
 *   rail={<><h1>Templates</h1><SearchInput … /><CategoryNav … /></>}
 *   contentClassName="overflow-y-auto"
 * >
 *   <ResultSections … />
 * </FilterRailLayout>
 * ```
 */

import type {ReactNode} from "react"

import {cn} from "../../../utils/styles"

export interface FilterRailLayoutProps {
    /** Title, search, facets — everything you filter WITH. Never scrolls with the results. */
    rail: ReactNode
    /** The results. */
    children: ReactNode
    className?: string
    railClassName?: string
    /** Where scrolling lives on this page, e.g. `"overflow-y-auto"`. */
    contentClassName?: string
}

const RAIL_CLASS =
    "box-border flex w-full shrink-0 flex-col gap-6 overflow-y-auto border-x-0 border-y-0 border-solid border-colorBorderSecondary px-6 py-6 lg:w-[280px] lg:border-r lg:bg-colorFillQuaternary"

export function FilterRailLayout({
    rail,
    children,
    className,
    railClassName,
    contentClassName,
}: FilterRailLayoutProps) {
    return (
        <div className={cn("flex min-h-0 w-full flex-1 flex-col lg:flex-row", className)}>
            <aside className={cn(RAIL_CLASS, railClassName)}>{rail}</aside>
            {/* `min-w-0` is load-bearing beside the rail: a flex item defaults to
                `min-width: auto`, so without it this column refuses to shrink below its widest
                row and the page scrolls sideways — and no amount of `truncate` INSIDE a row can
                help, because the ancestor is what grew. */}
            <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", contentClassName)}>
                {children}
            </div>
        </div>
    )
}
